using System;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using BlackThunder.BlackPy;
using NUnit.Framework;

namespace BlackThunder.BlackPy.Tests
{
    [TestFixture]
    public class SceneControllerTests
    {
        [Test]
        public void SubmissionCopiesTheWholeFrameAndSerializesItWithoutOutput()
        {
            var scene = new SceneController();
            scene.BeginRun("first");
            var frame = Frame("first");
            scene.Submit(frame);
            frame.Scene.Sprites[0].X = 999;
            frame.Scene.Sprites = Array.Empty<SpriteState>();
            frame.Scene.Message = "changed";
            Assert.That(scene.State.Sprites[0].Speech, Is.EqualTo("안녕!"));

            Assert.That(scene.State.Active, Is.True);
            Assert.That(scene.State.Sprites[0].X, Is.EqualTo(25));
            Assert.That(scene.State.Message, Is.EqualTo("자동차 출발!"));
            var message = new StateMessage { Scene = scene.State };
            var next = Frame("first");
            next.Scene.Sprites[0].X = 50;
            scene.Submit(next);
            Assert.That(message.Scene.Sprites[0].X, Is.EqualTo(25));
            Assert.That(scene.State.Sprites[0].X, Is.EqualTo(50));
            using var json = JsonDocument.Parse(message.Serialize(false));
            Assert.That(json.RootElement.GetProperty("scene").GetProperty("active").GetBoolean(), Is.True);
            Assert.That(json.RootElement.GetProperty("scene").GetProperty("sprites").GetArrayLength(), Is.EqualTo(1));
        }

        [Test]
        public void SixtyFourSpritesWithFullUnicodeSpeechFitTheRequestLimit()
        {
            var scene = new SceneController();
            scene.BeginRun("run");
            var frame = Frame("run");
            frame.Scene.Message = new string('가', 200);
            frame.Scene.Sprites = new SpriteState[64];

            for (int i = 0; i < frame.Scene.Sprites.Length; i++)
            {
                frame.Scene.Sprites[i] = new SpriteState
                {
                    Id = "character-" + i,
                    Label = new string('나', 80),
                    Speech = new string('다', 200),
                    X = -100000,
                    Y = 100000,
                    Width = 2000,
                    Height = 2000,
                    Heading = -1000000
                };
            }

            scene.Submit(frame);
            Assert.That(scene.State.Sprites.Length, Is.EqualTo(64));
            Assert.That(JsonSerializer.SerializeToUtf8Bytes(frame, StateMessage.JsonOptions).Length,
                Is.LessThanOrEqualTo(262144));
        }

        [Test]
        public void StopRetainsLastSceneAndNewRunResetsIt()
        {
            var scene = new SceneController();
            scene.BeginRun("first");
            scene.Submit(Frame("first"));
            scene.EndRun();
            Assert.That(scene.State.Sprites[0].X, Is.EqualTo(25));
            AssertStatus(409, () => scene.Submit(Frame("first")));
            scene.BeginRun("second");
            Assert.That(scene.State.Active, Is.False);
            Assert.That(scene.State.Sprites, Is.Empty);
            AssertStatus(409, () => scene.Submit(Frame("first")));
            scene.Submit(Frame("second"));
            Assert.That(scene.State.Active, Is.True);
        }

        [TestCase(double.NaN)]
        [TestCase(double.PositiveInfinity)]
        [TestCase(double.NegativeInfinity)]
        [TestCase(100001)]
        [TestCase(-100001)]
        public void InvalidPositionDoesNotReplaceThePreviousScene(double position)
        {
            var scene = new SceneController();
            scene.BeginRun("run");
            scene.Submit(Frame("run"));
            var frame = Frame("run");
            frame.Scene.Sprites[0].X = position;
            AssertStatus(400, () => scene.Submit(frame));
            Assert.That(scene.State.Sprites[0].X, Is.EqualTo(25));
        }

        [Test]
        public void InvalidTextKindsSizesAndDuplicateNamesAreRejected()
        {
            var scene = new SceneController();
            scene.BeginRun("run");
            var frame = Frame("run");
            frame.Scene.Background = "unknown";
            AssertStatus(400, () => scene.Submit(frame));
            frame = Frame("run");
            frame.Scene.Message = new string('a', 201);
            AssertStatus(400, () => scene.Submit(frame));
            frame = Frame("run");
            frame.Scene.Sprites[0].Kind = "unknown";
            AssertStatus(400, () => scene.Submit(frame));
            frame = Frame("run");
            frame.Scene.Sprites[0].Color = "url(untrusted)";
            AssertStatus(400, () => scene.Submit(frame));
            frame = Frame("run");
            frame.Scene.Sprites[0].Speech = new string('가', 201);
            AssertStatus(400, () => scene.Submit(frame));
            frame = Frame("run");
            frame.Scene.Sprites[0].Width = 0;
            AssertStatus(400, () => scene.Submit(frame));
            frame = Frame("run");
            frame.Scene.Sprites = new[] { frame.Scene.Sprites[0], frame.Scene.Sprites[0] };
            AssertStatus(400, () => scene.Submit(frame));
            frame.Scene.Sprites = new SpriteState[65];
            AssertStatus(400, () => scene.Submit(frame));
            frame.Scene = null!;
            AssertStatus(400, () => scene.Submit(frame));
        }

        [Test]
        public async Task LastBrowserDisconnectStopsFramesAndReconnectStartsWithAnEmptyScene()
        {
            var directory = Path.Combine(Path.GetTempPath(), "BlackPySceneTests-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            await File.WriteAllTextAsync(Path.Combine(directory, "project.json"),
                "{\"background\":{\"file\":\"배경.py\"},\"actors\":[]}");
            await File.WriteAllTextAsync(Path.Combine(directory, "배경.py"), "import time\ntime.sleep(60)\n");

            try
            {
                var python = ProjectTestDirectory.PassivePython(await PythonCommand.ResolveAsync());
                await using var session = new RuntimeSession(directory, python, "http://127.0.0.1:1", "test-token");
                var browser = await session.ConnectAsync();
                var first = await session.RunAsync();
                await session.FrameAsync(Frame(first.RunId!));
                await session.DisconnectAsync(browser);
                var stopped = await session.StopAsync();
                Assert.That(stopped.Status, Is.EqualTo("stopped"));
                Assert.That(stopped.Scene.Sprites[0].Kind, Is.EqualTo("car"));
                var stoppedError = Assert.ThrowsAsync<BlackPyException>(async () =>
                    await session.FrameAsync(Frame(first.RunId!)));
                Assert.That(stoppedError!.StatusCode, Is.EqualTo(409));

                await session.ConnectAsync();
                var second = await session.RunAsync();
                Assert.That(second.Scene.Active, Is.False);
                var staleError = Assert.ThrowsAsync<BlackPyException>(async () =>
                    await session.FrameAsync(Frame(first.RunId!)));
                Assert.That(staleError!.StatusCode, Is.EqualTo(409));
                var updated = await session.FrameAsync(Frame(second.RunId!));
                Assert.That(updated.Scene.Active, Is.True);
            }
            finally
            {
                Directory.Delete(directory, true);
            }
        }

        [Test]
        public async Task PythonCompletionPublishesTheFinalSceneToTheBrowser()
        {
            var directory = Path.Combine(Path.GetTempPath(), "BlackPySceneTests-" + Guid.NewGuid().ToString("N"));
            Directory.CreateDirectory(directory);
            await File.WriteAllTextAsync(Path.Combine(directory, "project.json"),
                "{\"background\":{\"file\":\"배경.py\"},\"actors\":[]}");
            await File.WriteAllTextAsync(Path.Combine(directory, "배경.py"),
                "import os, time\nwhile not os.path.exists('finish'):\n    time.sleep(0.01)\n");

            try
            {
                var python = ProjectTestDirectory.PassivePython(await PythonCommand.ResolveAsync(),
                    "import os, time\nwhile not os.path.exists('finish'):\n    time.sleep(0.01)\n");
                await using var session = new RuntimeSession(directory, python, "http://127.0.0.1:1", "test-token");
                var browser = await session.ConnectAsync();
                var running = await session.RunAsync();
                await session.FrameAsync(Frame(running.RunId!));
                await File.WriteAllTextAsync(Path.Combine(directory, "finish"), "");

                StateMessage completed;
                do
                {
                    completed = await browser.Messages.Reader.ReadAsync().AsTask().WaitAsync(TimeSpan.FromSeconds(5));
                } while (completed.Status == "running" || completed.Status == "ready");

                Assert.That(completed.Status, Is.EqualTo("completed"));
                Assert.That(completed.Scene.Active, Is.True);
                Assert.That(completed.Scene.Sprites[0].X, Is.EqualTo(25));
                Assert.That(completed.Scene.Message, Is.EqualTo("자동차 출발!"));
                var rejected = Assert.ThrowsAsync<BlackPyException>(async () =>
                    await session.FrameAsync(Frame(running.RunId!)));
                Assert.That(rejected!.StatusCode, Is.EqualTo(409));
            }
            finally
            {
                Directory.Delete(directory, true);
            }
        }

        private static SceneFrameRequest Frame(string runId) => new()
        {
            RunId = runId,
            Scene = new SceneState
            {
                Background = "city",
                Message = "자동차 출발!",
                Sprites = new[] { new SpriteState { Id = "car", Kind = "car", X = 25, Y = -30, Speech = "안녕!" } }
            }
        };

        private static void AssertStatus(int status, TestDelegate action) =>
            Assert.That(Assert.Throws<BlackPyException>(action)!.StatusCode, Is.EqualTo(status));
    }
}
