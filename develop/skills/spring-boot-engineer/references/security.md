# Security (Spring Security 6)

## Filter chain as a bean

`WebSecurityConfigurerAdapter` is gone. Declare a `SecurityFilterChain` bean and use the lambda DSL.

```java
@Configuration
@EnableWebSecurity
@EnableMethodSecurity
class SecurityConfig {

    @Bean
    SecurityFilterChain api(HttpSecurity http, JwtAuthFilter jwt) throws Exception {
        return http
            .cors(Customizer.withDefaults())
            .csrf(AbstractHttpConfigurer::disable)               // stateless, token in header
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(a -> a
                .requestMatchers("/auth/**", "/actuator/health/**", "/error").permitAll()
                .requestMatchers(HttpMethod.GET, "/api/v1/catalog/**").permitAll()
                .requestMatchers("/api/v1/admin/**").hasRole("ADMIN")
                .anyRequest().authenticated())
            .exceptionHandling(e -> e
                .authenticationEntryPoint(new HttpStatusEntryPoint(HttpStatus.UNAUTHORIZED)))
            .addFilterBefore(jwt, UsernamePasswordAuthenticationFilter.class)
            .build();
    }

    @Bean
    PasswordEncoder encoder() { return PasswordEncoderFactories.createDelegatingPasswordEncoder(); }

    @Bean
    AuthenticationManager authenticationManager(AuthenticationConfiguration cfg) throws Exception {
        return cfg.getAuthenticationManager();
    }
}
```

- Matchers are evaluated top to bottom; the first match wins, so put the specific ones first and `anyRequest()` last.
- Disable CSRF only for APIs that authenticate with a header token and keep no session cookie. Browser apps with cookie sessions keep it on.
- `hasRole("ADMIN")` checks the authority `ROLE_ADMIN`; `hasAuthority` compares verbatim.

## Self-issued JWT

Prefer an identity provider and the resource-server setup below. If the service must issue tokens itself, keep these properties:
- A signing key of adequate size from configuration, never a literal in code.
- Short access-token lifetime (minutes) and a distinct refresh path.
- Validate signature, expiry and issuer on every request.

A request filter then loads the principal and fills the context:

```java
@Component
class JwtAuthFilter extends OncePerRequestFilter {
    private final TokenService tokens;
    private final UserDetailsService users;

    JwtAuthFilter(TokenService tokens, UserDetailsService users) {
        this.tokens = tokens; this.users = users;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        String header = req.getHeader(HttpHeaders.AUTHORIZATION);
        if (header != null && header.startsWith("Bearer ")
                && SecurityContextHolder.getContext().getAuthentication() == null) {
            try {
                String username = tokens.verifyAndGetSubject(header.substring(7));
                UserDetails user = users.loadUserByUsername(username);
                var auth = UsernamePasswordAuthenticationToken.authenticated(
                        user, null, user.getAuthorities());
                auth.setDetails(new WebAuthenticationDetailsSource().buildDetails(req));
                SecurityContextHolder.getContext().setAuthentication(auth);
            } catch (JwtException | UsernameNotFoundException e) {
                SecurityContextHolder.clearContext();   // fall through as anonymous
            }
        }
        chain.doFilter(req, res);
    }
}
```

`TokenService` is a thin wrapper over a JWT library of your choice; verification must reject `alg=none` and unexpected algorithms.

## Users and passwords

```java
@Service
class AccountUserDetailsService implements UserDetailsService {
    private final AccountRepository accounts;
    AccountUserDetailsService(AccountRepository accounts) { this.accounts = accounts; }

    public UserDetails loadUserByUsername(String email) throws UsernameNotFoundException {
        Account a = accounts.findByEmail(email)
            .orElseThrow(() -> new UsernameNotFoundException(email));
        return User.withUsername(a.getEmail())
            .password(a.getPasswordHash())
            .authorities(a.getRoles().stream().map(r -> "ROLE_" + r).toArray(String[]::new))
            .disabled(!a.isActive())
            .build();
    }
}
```

The delegating encoder above stores an algorithm prefix (`{bcrypt}...`) with each hash, so the algorithm can be upgraded later; `BCryptPasswordEncoder` or `Argon2PasswordEncoder` can also be used directly. Login failures return one generic message for unknown user and wrong password.

## Resource server (preferred for JWT)

Dependency: `spring-boot-starter-oauth2-resource-server`. Configuration:

```properties
spring.security.oauth2.resourceserver.jwt.issuer-uri=https://idp.example.com/realms/acme
```

```java
http.authorizeHttpRequests(a -> a.anyRequest().hasAuthority("SCOPE_orders.read"))
    .oauth2ResourceServer(o -> o.jwt(j -> j.jwtAuthenticationConverter(converter())));

JwtAuthenticationConverter converter() {
    var authorities = new JwtGrantedAuthoritiesConverter();
    authorities.setAuthoritiesClaimName("roles");
    authorities.setAuthorityPrefix("ROLE_");
    var c = new JwtAuthenticationConverter();
    c.setJwtGrantedAuthoritiesConverter(authorities);
    return c;
}
```

Boot discovers the issuer's JWK set and builds a `JwtDecoder`; a decoder validating `iss` and `exp` is configured for you. Add an audience check with a custom `OAuth2TokenValidator<Jwt>` when tokens are shared across services. By default scopes map to `SCOPE_*` authorities.

## Method-level rules

`@EnableMethodSecurity` turns on `@PreAuthorize`, `@PostAuthorize`, `@PreFilter` and `@PostFilter`.

```java
@PreAuthorize("hasRole('ADMIN') or #ownerId == authentication.principal.username")
public List<Document> documentsOf(String ownerId) { ... }

@PostAuthorize("returnObject.owner == authentication.name")
public Document load(long id) { ... }
```

Method rules defend the service when it is called from another entry point (a message listener, a scheduler); URL rules alone do not. Self-invocation bypasses them, the same as with transactions.

## Reading the caller

Inject `@AuthenticationPrincipal` into a controller parameter instead of reaching into `SecurityContextHolder`:

```java
@GetMapping("/me")
ProfileResponse me(@AuthenticationPrincipal Jwt jwt) { return profiles.byId(jwt.getSubject()); }
```

## Hardening list

- Secrets and keys come from the environment or a secret manager.
- Rate-limit login and token endpoints.
- Return 401 for missing or invalid credentials and 403 for insufficient rights.
- Do not log tokens or passwords.
- Keep `Strict-Transport-Security` and the other default security headers on; only change them with a reason.
- Add security tests (see testing) for each rule: anonymous, wrong role, right role.
