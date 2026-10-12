# Generating API Docs from Framework Code

Prefer annotations or types that the framework turns into an OpenAPI document. Hand-written YAML drifts.

## Spring Boot + Kotlin (springdoc-openapi)

Dependency: `org.springdoc:springdoc-openapi-starter-webmvc-ui` (use the `webflux-ui` variant for WebFlux). Defaults: spec at `/v3/api-docs`, UI at `/swagger-ui.html`.

```kotlin
@RestController
@RequestMapping("/api/v1/invoices")
@Tag(name = "Invoices", description = "Issue and query invoices")
class InvoiceController(private val service: InvoiceService) {

    @Operation(summary = "Fetch an invoice", description = "Returns 404 when the id is unknown.")
    @ApiResponses(
        ApiResponse(responseCode = "200", description = "Found"),
        ApiResponse(responseCode = "404", description = "No such invoice",
            content = [Content(schema = Schema(implementation = ProblemDetail::class))]),
    )
    @GetMapping("/{id}")
    fun get(@Parameter(description = "Invoice id") @PathVariable id: Long): InvoiceResponse =
        service.find(id)
}

@Schema(description = "Invoice as seen by API clients")
data class InvoiceResponse(
    @field:Schema(example = "INV-2026-0001") val number: String,
    @field:Schema(description = "Total in minor units", example = "125000") val totalCents: Long,
)
```

Notes: Kotlin needs the `@field:` use-site target on constructor properties for the annotation to reach the field. Bean Validation constraints (`@NotBlank`, `@Size`) are reflected into the schema automatically. Group endpoints with `GroupedOpenApi` beans when one app serves several audiences. Disable the UI in production through the `springdoc.swagger-ui.enabled` property if it should not be public.

## FastAPI

Types and Pydantic models drive the schema; the docstring becomes the operation description.

```python
@router.get(
    "/invoices/{invoice_id}",
    response_model=InvoiceOut,
    summary="Fetch an invoice",
    responses={404: {"description": "No such invoice"}},
    tags=["invoices"],
)
async def get_invoice(invoice_id: int = Path(..., description="Invoice id")):
    """Return one invoice. Markdown in this docstring is rendered in the docs."""
```

Field-level docs: `Field(description=..., examples=[...])` inside the model. Docs live at `/docs` (Swagger UI) and `/redoc`, spec at `/openapi.json`.

## Django REST Framework

Use drf-spectacular. Decorate views with `@extend_schema(summary=..., responses=..., parameters=[...])`, expose the schema view, and let serializers supply field metadata through `help_text`.

## NestJS

Enable the `@nestjs/swagger` plugin in `nest-cli.json` to infer DTO properties; add explicit decorators where inference falls short.

```typescript
@ApiTags('invoices')
@Controller('invoices')
export class InvoicesController {
  @Get(':id')
  @ApiOperation({ summary: 'Fetch an invoice' })
  @ApiResponse({ status: 200, type: InvoiceDto })
  @ApiResponse({ status: 404, description: 'No such invoice' })
  get(@Param('id') id: string) { /* ... */ }
}

export class InvoiceDto {
  @ApiProperty({ example: 'INV-2026-0001' }) number: string;
  @ApiPropertyOptional() note?: string;
}
```

Mount with `SwaggerModule.createDocument(app, config)` then `SwaggerModule.setup('docs', app, document)`.

## Express

No types to read, so use `swagger-jsdoc`: write `@openapi` YAML blocks in comments above routes and point the `apis` option at those files. Keep schemas in `components` and reference them with `$ref`.

## Always

- Every endpoint: summary, each status code it can return, an example body.
- Error responses share one schema (for Spring, RFC 7807 `ProblemDetail`).
- Run the spec through a linter in CI: `npx @redocly/cli lint openapi.yaml`.
