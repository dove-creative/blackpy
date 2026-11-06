"""놀이 명령의 시간, 좌표, 동시 움직임과 입력 경계를 확인합니다."""

import copy
import importlib.util
import math
from pathlib import Path
import unittest
from unittest.mock import patch


MODULE = Path(__file__).resolve().parents[1] / "distribution" / "blackpy.py"


class AnimationTests(unittest.TestCase):
    def setUp(self):
        spec = importlib.util.spec_from_file_location("blackpy", MODULE)
        self.api = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.api)
        self.frames = []
        self.api.stage._send = lambda scene: self.frames.append(
            copy.deepcopy(scene)
        )
        self.clock = 0
        self.patches = [
            patch.object(self.api.time, "monotonic", lambda: self.clock),
            patch.object(self.api.time, "sleep", self.advance),
        ]

        for replacement in self.patches:
            replacement.start()
            self.addCleanup(replacement.stop)

    def advance(self, seconds):
        self.clock += seconds

    def actor(self, kind="cat", **kwargs):
        return self.api.Actor(kind, **kwargs)

    def test_move_blocks_until_distance_over_speed(self):
        actor = self.actor()
        actor.set_speed(100)
        actor.forward(150)
        self.assertAlmostEqual(self.clock, 1.5)
        self.assertAlmostEqual(actor.x, 150)
        self.assertTrue(any(
            0 < f["sprites"][0]["x"] < 150 for f in self.frames
        ))

    def test_signed_distance_and_goto_preserve_heading(self):
        actor = self.actor()
        actor.left(90)
        actor.forward(-40)
        self.assertAlmostEqual(actor.x, 0)
        self.assertAlmostEqual(actor.y, -40)
        actor.backward(-20)
        self.assertAlmostEqual(actor.y, -20)
        actor.goto(25, 30)
        self.assertEqual(actor._heading, 90)
        self.assertEqual((actor.x, actor.y), (25, 30))

    def test_full_turn_has_intermediate_frames_and_returns_to_heading(self):
        actor = self.actor()
        actor.right(360)
        headings = [f["sprites"][0]["heading"] for f in self.frames]
        self.assertTrue(any(-300 < angle < -60 for angle in headings))
        self.assertEqual(actor._heading, 0)
        self.assertAlmostEqual(self.clock, 2)

    def test_zero_distance_is_immediate(self):
        actor = self.actor()
        actor.forward(0)
        actor.left(0)
        self.assertEqual(self.clock, 0)
        self.assertEqual(actor.x, 0)

    def test_race_uses_speed_and_distance_with_simultaneous_frames(self):
        slow = self.actor(x=-260, y=80, name="토끼")
        fast = self.actor(x=-260, y=-100, name="고양이")
        slow.set_speed(100)
        fast.set_speed(200)
        result = self.api.stage.race(slow, fast)
        self.assertEqual(result, "고양이")
        self.assertAlmostEqual(self.clock, 5.2)
        self.assertEqual((slow.x, fast.x), (260, 260))
        moving = [f["sprites"] for f in self.frames if len(f["sprites"]) == 2]
        self.assertTrue(any(-260 < a["x"] < b["x"] < 260 for a, b in moving))
        self.assertTrue(any(a["x"] < 260 and b["x"] == 260 for a, b in moving))

    def test_race_equal_arrival_is_a_tie(self):
        left = self.actor(x=0, name="하나")
        right = self.actor(x=130, name="둘")
        left.set_speed(200)
        right.set_speed(100)
        self.assertEqual(
            self.api.stage.race(left, right), "공동 1등: 하나, 둘"
        )

    def test_dribble_preserves_offset_and_returns_ball_to_ground(self):
        player = self.actor(x=-240, y=-80)
        ball = self.actor("ball", x=-170, y=-180)
        self.api.stage.dribble(
            player, ball, bounces=2, height=100, distance=360
        )
        self.assertAlmostEqual(self.clock, 1.4)
        self.assertEqual((player.x, player.y), (120, -80))
        self.assertEqual((ball.x, ball.y), (190, -180))
        moving = [f["sprites"] for f in self.frames if len(f["sprites"]) == 2]
        self.assertTrue(any(b["y"] > -85 for a, b in moving))

        for friend, sphere in moving:
            self.assertAlmostEqual(sphere["x"] - friend["x"], 70)
            self.assertGreaterEqual(sphere["y"], -180)
            self.assertLessEqual(sphere["y"], -80)

    def test_background_and_message_do_not_reset_actors(self):
        actor = self.actor(x=50)
        self.api.stage.background("forest")
        self.api.stage.say("숲속 친구들!")
        self.assertEqual(self.frames[-1]["message"], "숲속 친구들!")
        self.assertEqual(self.frames[-1]["background"], "forest")
        self.assertEqual(actor.x, 50)

    def test_invalid_values_fail_before_frames_change(self):
        actor = self.actor()

        for value in (True, "100", math.inf, math.nan, 10 ** 400):
            count = len(self.frames)

            with self.assertRaises((TypeError, ValueError)):
                actor.forward(value)

            self.assertEqual(len(self.frames), count)

        with self.assertRaises(ValueError):
            actor.set_speed(0)
        with self.assertRaises(ValueError):
            self.api.stage.race(actor, actor)
        with self.assertRaises(ValueError):
            self.api.stage.race(actor, finish_x=-100)
        with self.assertRaises(ValueError):
            self.api.Actor("unsupported")

    def test_wait_and_message_publish_in_order(self):
        self.api.stage.say("준비")
        self.api.stage.wait(0.5)
        self.api.stage.say("시작")
        self.assertAlmostEqual(self.clock, 0.5)
        self.assertTrue(all(f["message"] == "준비" for f in self.frames[:-1]))
        self.assertEqual(self.frames[-1]["message"], "시작")


if __name__ == "__main__":
    unittest.main()
