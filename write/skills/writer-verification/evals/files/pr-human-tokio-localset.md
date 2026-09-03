<!-- Human-written, verbatim: tokio-rs/tokio#1733 (2019). Used as a false-positive control for the humanizer. -->
# add `task::LocalSet` API for running `!Send` futures

## Motivation

In earlier versions of `tokio`, the `current_thread::Runtime` type could
be used to run `!Send` futures. However, PR #1716 merged the
current-thread and threadpool runtimes into a single type, which can no
longer run `!Send` futures. There is still a need in some cases to
support futures that don't implement `Send`, and the `tokio-compat`
crate requires this in order to provide APIs that existed in `tokio`
0.1.

## Solution

This branch implements the API described by @carllerche in
https://github.com/tokio-rs/tokio/pull/1716#issuecomment-549496309. It
adds a new `LocalSet` type and `spawn_local` function to `tokio::task`.
The `LocalSet` type is used to group together a set of tasks which must
run on the same thread and don't implement `Send`. These are available
when a new "rt-util" feature flag is enabled.

Currently, the local task set is run by passing it a reference to a
`Runtime` and a future to `block_on`. In the future, we may also want
to investigate allowing spawned futures to construct their own local
task sets, which would be executed on the worker that the future is
executing on. 

In order to implement the new API, I've made some internal changes to
the `task` module and `Schedule` trait to support scheduling both `Send`
and `!Send` futures.