# Android with Jetpack Compose

## Composition model

A composable describes UI from its inputs; Compose re-runs it when state it read changes. Therefore:
- Composables must be free of side effects in their body and cheap to re-run.
- State is hoisted: a composable takes `value` and `onChange` rather than owning state, which makes it testable and previewable.
- Pass the smallest data a composable needs; stable, immutable parameters let Compose skip re-running it.

```kotlin
@Composable
fun QuantityStepper(value: Int, onChange: (Int) -> Unit, modifier: Modifier = Modifier) {
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = { onChange(value - 1) }, enabled = value > 0) { Icon(Icons.Default.Remove, "less") }
        Text("$value")
        IconButton(onClick = { onChange(value + 1) }) { Icon(Icons.Default.Add, "more") }
    }
}
```

Always accept a `modifier` parameter as the first optional argument.

## State holders

| Kind | Tool | Survives rotation | Survives process death |
|------|------|-------------------|------------------------|
| UI element state | `remember { mutableStateOf(..) }` | no | no |
| Same, persisted across config change | `rememberSaveable` | yes | yes (Bundle-able types) |
| Screen state | `ViewModel` exposing `StateFlow<UiState>` | yes | only with `SavedStateHandle` |

```kotlin
@HiltViewModel
class CartViewModel @Inject constructor(private val repo: CartRepo) : ViewModel() {
    val state: StateFlow<CartUi> = repo.items()
        .map { CartUi.Content(it) }
        .stateIn(viewModelScope, SharingStarted.WhileSubscribed(5_000), CartUi.Loading)
    fun remove(id: Long) = viewModelScope.launch { repo.remove(id) }
}

@Composable
fun CartRoute(vm: CartViewModel = hiltViewModel()) {
    val ui by vm.state.collectAsStateWithLifecycle()
    CartScreen(ui, onRemove = vm::remove)
}
```

`collectAsStateWithLifecycle()` (from `lifecycle-runtime-compose`) stops collecting when the UI is not visible. Split a screen into a stateful `Route` and a stateless `Screen` so previews and tests need no ViewModel.

One-off events (navigate, show snackbar) are better modeled as state that the UI consumes and clears than as a fire-and-forget channel, since the latter can drop events during recomposition gaps.

## Effects

| API | Use |
|-----|-----|
| `LaunchedEffect(key)` | run a suspend block when entering composition or when `key` changes; cancelled on leave |
| `DisposableEffect(key)` | register and unregister a listener; end with `onDispose { }` |
| `rememberCoroutineScope()` | launch from event callbacks such as a click |
| `rememberUpdatedState(v)` | read the latest value inside a long-lived effect without restarting it |
| `derivedStateOf { }` | state computed from other state, recomputing only when the result can change |
| `SideEffect` | publish Compose state to non-Compose code after every successful recomposition |

Wrong keys are the usual bug: `LaunchedEffect(Unit)` that reads a changing value captures a stale copy.

## Lists

```kotlin
LazyColumn(
    contentPadding = PaddingValues(horizontal = 16.dp),
    verticalArrangement = Arrangement.spacedBy(12.dp),
) {
    items(orders, key = { it.id }) { order -> OrderRow(order, Modifier.animateItem()) }
}
```

- Provide a stable `key` so items keep state and animate correctly when the list changes (`animateItem()` in recent Compose versions; older ones used `animateItemPlacement()`).
- Avoid nesting a vertically scrolling lazy list in another vertical scroller.
- Use `contentType` when row types differ to improve reuse.

## Navigation

Navigation Compose: one `NavHost` with destinations.

```kotlin
@Serializable data class OrderDetail(val id: Long)

NavHost(navController, startDestination = OrderList) {
    composable<OrderList> { OrderListRoute(onOpen = { navController.navigate(OrderDetail(it)) }) }
    composable<OrderDetail> { entry -> OrderDetailRoute(entry.toRoute<OrderDetail>().id) }
}
```

Type-safe routes with `@Serializable` classes require a recent Navigation Compose (2.8+). Pass IDs, not whole objects, and load data in the destination's ViewModel. Hand navigation callbacks down as lambdas instead of passing `NavController` to leaf composables.

## Material 3 and theming

Wrap the app in a `MaterialTheme(colorScheme, typography, shapes)`. Read colors from `MaterialTheme.colorScheme.*` rather than hard-coded values; this is what makes dark mode and dynamic color (`dynamicLightColorScheme(context)`, Android 12+) work. Use `Scaffold` for top bar, bottom bar, snackbar host, and content padding; apply its `innerPadding` to the content.

## Performance checks

- Read state as late as possible; pass lambdas (`{ scroll.value }`) to modifiers that read state in layout or draw phases instead of reading it in composition.
- Prefer immutable collections or `@Immutable` / `@Stable` wrappers for parameters if the compiler reports them unstable; strong skipping mode in current Kotlin Compose compiler lowers this concern.
- Use `remember` for expensive allocations, and `key` in `remember(key)` when inputs change.
- Measure with the Layout Inspector's recomposition counts and release-build macrobenchmarks, not debug builds.
- Add a baseline profile for startup and scrolling on release builds.

## Testing

`createComposeRule()`; find nodes by semantics (`onNodeWithText`, `onNodeWithTag`), act (`performClick()`), assert (`assertIsDisplayed()`). Test stateless screens with fixed `UiState` values; test ViewModels separately with `runTest`.
