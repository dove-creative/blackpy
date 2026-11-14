"""프레임 지연의 누적과 긴 정지 뒤의 과도한 갱신을 가상 시계로 검증합니다."""

import asyncio
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from test_runtime_support import make_runtime


class FramePacingTests(unittest.IsolatedAsyncioTestCase):
    async def run_frames(self, work_times, oversleep):
        runtime = make_runtime('def 키_누름(키):\n    pass\n')
        clock = [100.0]
        frames = []
        real_sleep = asyncio.sleep

        async def sleep(delay):
            if delay > 0:
                clock[0] += delay + oversleep
            await real_sleep(0)

        def blocking_sleep(delay):
            clock[0] += delay + oversleep

        async def to_thread(function, *args):
            function(*args)
            await real_sleep(0)

        class Transport:
            async def events(self):
                return []

            async def publish(self, scene):
                if runtime.stopped:
                    return
                frames.append(clock[0])
                clock[0] += work_times[len(frames) - 1]
                if len(frames) == len(work_times):
                    runtime.stopped = True

        with patch('_blackpy_runtime.time', SimpleNamespace(
                perf_counter=lambda: clock[0], sleep=blocking_sleep)), \
                patch('_blackpy_runtime.asyncio.sleep', sleep), \
                patch('_blackpy_runtime.asyncio.to_thread', to_thread):
            await runtime.run(Transport())
        return frames, runtime.elapsed

    async def test_short_wake_delays_do_not_lower_the_frame_rate(self):
        frames, _ = await self.run_frames([0.002, 0.006, 0.001] * 20, 0.004)
        # The first late wake is allowed; subsequent deadlines retain 60 Hz.
        self.assertAlmostEqual(frames[-1] - frames[1], (len(frames) - 2) / 60)
        for previous, current in zip(frames[1:], frames[2:]):
            self.assertAlmostEqual(current - previous, 1 / 60)

    async def test_long_work_keeps_elapsed_time_without_a_catch_up_burst(self):
        frames, elapsed = await self.run_frames([0.002, 0.2] + [0.002] * 8, 0)
        self.assertAlmostEqual(frames[2] - frames[1], 0.2)
        for previous, current in zip(frames[2:], frames[3:]):
            self.assertAlmostEqual(current - previous, 1 / 60)
        self.assertAlmostEqual(elapsed, frames[-1] - frames[0])


if __name__ == '__main__':
    unittest.main()
