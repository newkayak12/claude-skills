# Minimal Working Example

A small `Book` catalog: entity, repository, request/response records, service, controller.

```java
@Entity
@Table(name = "books")
public class Book {
    @Id
    @GeneratedValue(strategy = GenerationType.SEQUENCE)
    private Long id;

    @NotBlank
    private String title;

    @PositiveOrZero
    private BigDecimal cost;
    // accessors omitted
}

public interface BookRepository extends JpaRepository<Book, Long> {
    List<Book> findByTitleContainingIgnoreCase(String fragment);
}

public record BookRequest(@NotBlank String title, @PositiveOrZero BigDecimal cost) {}

public record BookResponse(Long id, String title) {}

@Service
public class BookService {
    private final BookRepository books;

    public BookService(BookRepository books) { this.books = books; }

    @Transactional(readOnly = true)
    public List<Book> search(String fragment) {
        return books.findByTitleContainingIgnoreCase(fragment);
    }

    @Transactional
    public Book add(BookRequest req) {
        Book b = new Book();
        b.setTitle(req.title());
        b.setCost(req.cost());
        return books.save(b);
    }
}

@RestController
@RequestMapping("/api/v1/books")
public class BookController {
    private final BookService books;

    public BookController(BookService books) { this.books = books; }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public BookResponse add(@Valid @RequestBody BookRequest req) {
        Book saved = books.add(req);
        return new BookResponse(saved.getId(), saved.getTitle());
    }
}
```

Entities stay behind the service; the controller returns a response record (see `web.md`).
