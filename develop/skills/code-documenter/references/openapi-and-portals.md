# OpenAPI Structure and Documentation Portals

## Document skeleton (3.1)

Top-level keys: `openapi` (version string), `info` (title, version), `servers`, `paths`, `components`, optional global `security`, and `webhooks`.

3.1 aligns schemas with JSON Schema 2020-12: a nullable string is `type: [string, "null"]`, not `nullable: true`.

## Reuse through components

Define once under `components`, point to it with `$ref: '#/components/<kind>/<Name>'`. Kinds worth sharing: `schemas`, `parameters`, `responses`, `requestBodies`, `headers`, `examples`.

```yaml
components:
  parameters:
    Limit:
      in: query
      name: limit
      description: Rows per page
      schema:
        type: integer
        maximum: 200
  responses:
    Missing:
      description: The addressed resource is absent
      content:
        application/problem+json:
          schema:
            $ref: '#/components/schemas/Failure'

  schemas:
    Failure:                       # RFC 9457 problem details; shape abbreviated here
      type: object
      properties:
        type: {type: string}
        title: {type: string}
        status: {type: integer}
        detail: {type: string}
    Price:
      type: object
      required: [minor, iso]
      properties:
        minor: { type: integer, description: Amount in the smallest currency unit }
        iso: { type: string, description: ISO 4217 code }
```

Composition: `allOf`. Polymorphism: `oneOf` plus `discriminator.propertyName`. Named samples: `examples` (plural) on a media type.

## Security schemes

Declare under `components.securitySchemes`; the scheme `type` is one of `http`, `apiKey`, `oauth2`, `openIdConnect`.

- Bearer token: `type: http`, `scheme: bearer`, optional `bearerFormat`.
- API key: `type: apiKey` with `in` (`header`, `query`, `cookie`) and `name`.
- OAuth 2: `type: oauth2` with a `flows` object (`authorizationCode`, `clientCredentials`, ...), each listing its URLs and `scopes`.

Activate a scheme with a `security` requirement, globally or per operation; an empty list (`security: []`) on an operation marks it public.

## Callbacks and webhooks

3.1 adds a top-level `webhooks` map for events the provider pushes; document the payload schema and the signature header the receiver must verify.

## Rendering

| Tool | Strength | Note |
|------|----------|------|
| Swagger UI | Try-it-out console | Point it at a spec with `url`/`urls` (springdoc: `springdoc.swagger-ui.url`); hide in production if the API is private |
| Redoc | Readable three-pane reference | Static build with `npx @redocly/cli build-docs openapi.yaml` |
| Stoplight Elements | Embeddable web component | Fits inside an existing docs site |

Whatever the renderer, the spec file is the single source: lint it, version it, publish it from CI.

## Non-REST protocols

- GraphQL: descriptions in SDL (`"""..."""`) on types, fields, and arguments; introspection supplies the rest.
- Event/WebSocket APIs: describe channels, messages, and payload schemas with AsyncAPI.
- gRPC: comments on `.proto` messages, fields, and rpc methods are the docs; generators such as protoc-gen-doc render them.
