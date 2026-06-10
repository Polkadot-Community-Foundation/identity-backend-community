import { Duration, pipe, Stream } from 'effect'
import type { LazyArg } from 'effect/Function'

export const timeoutFirstFail =
  <E2>(error: LazyArg<E2>, duration: Duration.DurationInput) => <A, E, R>(stream: Stream.Stream<A, E, R>) =>
    pipe(
      stream,
      Stream.broadcast(2, { capacity: 'unbounded' }),
      Stream.flatMap(([first, second]) =>
        Stream.merge(
          first.pipe(
            Stream.timeoutFail(
              error,
              duration,
            ),
            Stream.take(1),
            Stream.flatMap(() => Stream.empty),
          ),
          second,
          { haltStrategy: 'right' },
        )
      ),
    )
