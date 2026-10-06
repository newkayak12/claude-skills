# Data Access

## Mapping entities

```java
@Entity
@Table(name = "invoices")
public class Invoice {
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE)
    private Long id;

    @Column(length = 40, nullable = false)
    private String number;

    private LocalDate dueDate;

    private BigDecimal total;

    @Enumerated(EnumType.STRING)
    private InvoiceStatus status;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "customer_id")
    private Customer customer;

    @OneToMany(mappedBy = "invoice", orphanRemoval = true, cascade = CascadeType.ALL)
    private List<InvoiceLine> lines = new ArrayList<>();

    @Version
    private long version;

    protected Invoice() {}          // required by JPA

    public void addLine(InvoiceLine l) { lines.add(l); l.setInvoice(this); }
}
```

Rules that prevent most production surprises:
- `@Enumerated(EnumType.STRING)`; ordinals break when the enum is reordered.
- Associations default to eager for `@ManyToOne` and `@OneToOne`; declare `LAZY` explicitly.
- Keep both sides of a bidirectional link in sync through a helper such as `addLine`.
- `@Version` gives optimistic locking; a concurrent update surfaces as `ObjectOptimisticLockingFailureException`.
- Do not use Lombok `@Data` on entities; generated `equals`/`hashCode`/`toString` touch lazy collections.

## Repositories

```java
public interface InvoiceRepository extends JpaRepository<Invoice, Long>,
                                           JpaSpecificationExecutor<Invoice> {

    Optional<Invoice> findByNumber(String number);

    @Query("select i from Invoice i join fetch i.customer where i.id = :id")
    Optional<Invoice> findWithCustomer(@Param("id") Long id);

    @EntityGraph(attributePaths = {"lines"})
    List<Invoice> findByStatus(InvoiceStatus status);

    @Modifying(clearAutomatically = true)
    @Query("update Invoice i set i.status = :to where i.status = :from and i.dueDate < :cutoff")
    int markOverdue(@Param("from") InvoiceStatus from, @Param("to") InvoiceStatus to,
                    @Param("cutoff") LocalDate cutoff);
}
```

Derived query names are fine until they exceed about three predicates; after that write `@Query`. Bulk `@Modifying` queries bypass the persistence context, hence `clearAutomatically`.

### Dynamic filters

Use a `Specification` per predicate and compose with `and`/`or`:

```java
static Specification<Invoice> hasStatus(InvoiceStatus s) {
    return (root, query, cb) -> (s == null) ? cb.conjunction() : cb.equal(root.get("status"), s);
}
repo.findAll(hasStatus(status).and(dueBefore(date)), pageable);
```

Returning `cb.conjunction()` (always true) for an absent filter keeps optional criteria composable.

## N+1 and fetching

The typical symptom is one query for the parent list and one more per row for a lazy association. Remedies, best first:
1. Project only what the screen needs (below).
2. `@EntityGraph` or `join fetch` for the one use case that needs the association.
3. `spring.jpa.properties.hibernate.default_batch_fetch_size` for collection loading.

Never `join fetch` a collection together with pagination; Hibernate paginates in memory and warns about it. Page the ids first, then fetch.

## Projections

```java
public interface InvoiceSummary { String getNumber(); BigDecimal getTotal(); }
public record InvoiceRow(String number, BigDecimal total) {}

List<InvoiceSummary> findByCustomerId(Long id);                 // interface-based
@Query("select new com.acme.InvoiceRow(i.number, i.total) from Invoice i")
List<InvoiceRow> rows();                                         // constructor expression
```

## Transactions

- Put `@Transactional` on service methods, one per use case. Read-only use cases get `readOnly = true`.
- The proxy only intercepts calls from outside the bean; calling a transactional method through `this` does nothing.
- Checked exceptions do not roll back unless `rollbackFor` says so.
- Keep remote calls out of the transaction; it holds a connection while waiting.
- To run something in its own transaction, use `Propagation.REQUIRES_NEW` in a different bean.

```java
@Service
class TransferService {
    @Transactional
    void transfer(long from, long to, BigDecimal amount) {
        // lock the lower id first so concurrent opposite transfers cannot deadlock
        Account first = accounts.findByIdForUpdate(Math.min(from, to)).orElseThrow();
        Account second = accounts.findByIdForUpdate(Math.max(from, to)).orElseThrow();
        Account a = from < to ? first : second;
        Account b = from < to ? second : first;
        a.withdraw(amount);
        b.deposit(amount);
    }
}

@Lock(LockModeType.PESSIMISTIC_WRITE)
@Query("select a from Account a where a.id = :id")
Optional<Account> findByIdForUpdate(@Param("id") Long id);
```

Lock rows in a consistent order (for example by ascending id) to avoid deadlocks.

## Auditing

```java
@EnableJpaAuditing
@Configuration class JpaConfig {}

@MappedSuperclass
@EntityListeners(AuditingEntityListener.class)
abstract class Audited {
    @CreatedDate
    @Column(updatable = false)
    Instant createdAt;

    @LastModifiedBy
    String updatedBy;

    @LastModifiedDate
    Instant updatedAt;
}
```

`@LastModifiedBy` (and `@CreatedBy`) need an `AuditorAware<String>` bean, typically reading the `SecurityContextHolder`.

## Schema migrations

Hibernate's `ddl-auto` is for throwaway databases. Use Flyway: add `flyway-core` (and `flyway-database-postgresql` for Flyway 10+), put scripts in `src/main/resources/db/migration` named `V3__add_invoice_due_date.sql`, never edit a script that has been applied, and switch Hibernate to schema verification (`ddl-auto: validate` under `spring.jpa.hibernate`) so the mapping is checked against the migrated schema.

```sql
ALTER TABLE invoices ADD COLUMN due_date date;
CREATE INDEX CONCURRENTLY idx_invoices_status_due ON invoices (status, due_date);
```

`CREATE INDEX CONCURRENTLY` cannot run in a transaction; put it in its own migration with `executeInTransaction=false` in a script configuration file.
