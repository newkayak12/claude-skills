# Request problem found before implementing

The request contradicts itself. It clamps pageSize to 50, and it also says
`paginate(items, 1, 100)` over 500 items must return 100 items. Both cannot hold.

Decision asked of the person: keep the clamp at 50 (and drop the 100-item example), or raise the cap.
Until answered, src/paginate.mjs clamps to 50.
