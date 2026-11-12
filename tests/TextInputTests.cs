using System;
using System.Text.Json;
using System.Threading.Tasks;
using BlackThunder.BlackPy;
using NUnit.Framework;

namespace BlackThunder.BlackPy.Tests
{
    [TestFixture]
    public class TextInputTests
    {
        [Test]
        public void PromptIsCopiedAndClearedWithoutChangingPublishedSnapshots()
        {
            var scene = new SceneController();
            scene.BeginRun("run");
            var frame = Frame("run", 1);
            scene.Submit(frame);
            var published = scene.State;
            frame.Scene.TextInput!.Message = "changed";
            Assert.That(published.TextInput!.Message, Is.EqualTo("이름은?"));

            using var json = JsonDocument.Parse(new StateMessage { Scene = published }.Serialize(false));
            var prompt = json.RootElement.GetProperty("scene").GetProperty("textInput");
            Assert.That(prompt.GetProperty("id").GetInt32(), Is.EqualTo(1));
            Assert.That(prompt.GetProperty("actor").GetString(), Is.EqualTo("고양이"));
            scene.EndRun();
            Assert.That(scene.State.TextInput, Is.Null);
            Assert.That(scene.State.Message, Is.EqualTo("계속 움직여요"));
            Assert.That(published.TextInput, Is.Not.Null);
        }

        [TestCase(0, "질문", "고양이")]
        [TestCase(-1, "질문", "고양이")]
        [TestCase(1, null, "고양이")]
        [TestCase(1, "질문", null)]
        public void InvalidPromptDoesNotReplaceTheLastScene(int id, string? message, string? actor)
        {
            var scene = new SceneController();
            scene.BeginRun("run");
            scene.Submit(Frame("run", 1));
            var frame = Frame("run", id);
            frame.Scene.TextInput!.Message = message!;
            frame.Scene.TextInput.Actor = actor!;
            AssertStatus(400, () => scene.Submit(frame));
            Assert.That(scene.State.TextInput!.Message, Is.EqualTo("이름은?"));
        }

        [Test]
        public void PromptTextLimitsAreValidatedBeforeReplacingTheScene()
        {
            var scene = new SceneController();
            scene.BeginRun("run");
            var frame = Frame("run", 1);
            frame.Scene.TextInput!.Message = new string('가', 2000);
            frame.Scene.TextInput.Actor = new string('나', 80);
            scene.Submit(frame);
            frame.Scene.TextInput.Message += "가";
            AssertStatus(400, () => scene.Submit(frame));
            frame.Scene.TextInput.Message = "";
            frame.Scene.TextInput.Actor += "나";
            AssertStatus(400, () => scene.Submit(frame));
            Assert.That(scene.State.TextInput!.Message.Length, Is.EqualTo(2000));
        }

        [TestCase("")]
        [TestCase("   ")]
        [TestCase(" 한글과 😀  ")]
        [TestCase("<script>alert('text')</script>")]
        public void AnswerIsDeliveredExactlyOnceWithoutTrimming(string text)
        {
            var input = new InputController();
            input.BeginRun("run");
            input.Submit(Answer("run", 1, text), 1);
            AssertStatus(409, () => input.Submit(Answer("run", 1, "second tab"), 1));
            var events = input.Drain("run");
            Assert.That(events.Length, Is.EqualTo(1));
            Assert.That(events[0].Kind, Is.EqualTo("answer"));
            Assert.That(events[0].PromptId, Is.EqualTo(1));
            Assert.That(events[0].Text, Is.EqualTo(text));
            using var json = JsonDocument.Parse(JsonSerializer.Serialize(events[0], StateMessage.JsonOptions));
            Assert.That(json.RootElement.GetProperty("text").GetString(), Is.EqualTo(text));
            AssertStatus(409, () => input.Submit(Answer("run", 1, "late"), 1));
        }

        [TestCase(null)]
        [TestCase("first\nsecond")]
        [TestCase("first\rsecond")]
        public void InvalidAnswerTextIsRejectedWithoutConsumingThePrompt(string? text)
        {
            var input = new InputController();
            input.BeginRun("run");
            AssertStatus(400, () => input.Submit(Answer("run", 1, text), 1));
            input.Submit(Answer("run", 1, "valid"), 1);
            Assert.That(input.Drain("run")[0].Text, Is.EqualTo("valid"));
        }

        [Test]
        public void AnswerLimitsAndPromptIdentityAreEnforced()
        {
            var input = new InputController();
            input.BeginRun("run");
            AssertStatus(400, () => input.Submit(Answer("run", 0, ""), 0));
            AssertStatus(400, () => input.Submit(Answer("run", 1, new string('가', 4097)), 1));
            AssertStatus(409, () => input.Submit(Answer("run", 1, "")));
            AssertStatus(409, () => input.Submit(Answer("run", 2, ""), 1));
            input.Submit(Answer("run", 1, new string('가', 4096)), 1);
            Assert.That(input.Drain("run")[0].Text!.Length, Is.EqualTo(4096));
            input.Submit(Answer("run", 2, "next"), 2);
            input.BeginRun("next");
            Assert.That(input.Drain("next"), Is.Empty);
            AssertStatus(409, () => input.Submit(Answer("run", 2, "stale"), 2));
            input.Submit(Answer("next", 1, "new run"), 1);
            input.EndRun();
            AssertStatus(409, () => input.Submit(Answer("next", 2, "stopped"), 2));
        }

        [Test]
        public void FocusResetPreservesAnAcceptedAnswerAndReleasesKeys()
        {
            var input = new InputController();
            input.BeginRun("run");
            input.Submit(new InputRequest { RunId = "run", Kind = "keydown", Key = "오른쪽" });
            input.Submit(Answer("run", 1, "고양이"), 1);
            input.Submit(new InputRequest { RunId = "run", Kind = "reset" });
            var events = input.Drain("run");
            Assert.That(events.Length, Is.EqualTo(2));
            Assert.That(events[0].Text, Is.EqualTo("고양이"));
            Assert.That(events[1].Kind, Is.EqualTo("reset"));
        }

        [Test]
        public void QueueRejectionAllowsRetryAndReservesSpaceForReset()
        {
            var input = new InputController();
            input.BeginRun("run");

            for (int id = 1; id <= 127; id++) input.Submit(Answer("run", id, ""), id);

            AssertStatus(429, () => input.Submit(Answer("run", 128, "retry"), 128));
            input.Submit(new InputRequest { RunId = "run", Kind = "reset" });
            Assert.That(input.Count, Is.EqualTo(128));
            input.Drain("run");
            input.Submit(Answer("run", 128, "retry"), 128);
            Assert.That(input.HasAnsweredPrompt(128), Is.True);
        }

        [Test]
        public async Task SessionHidesAnsweredPromptsAndRejectsStaleFramesAndRuns()
        {
            using var directory = new ProjectTestDirectory();
            var python = ProjectTestDirectory.PassivePython(await PythonCommand.ResolveAsync());
            await using var session = new RuntimeSession(directory.Path, python, "http://127.0.0.1:1", "test-token");
            await session.ConnectAsync();
            var first = await session.RunAsync();
            await session.FrameAsync(Frame(first.RunId!, 1));
            var answered = await session.InputAsync(Answer(first.RunId!, 1, "first tab"));
            Assert.That(answered.Scene.TextInput, Is.Null);
            var duplicate = Assert.ThrowsAsync<BlackPyException>(async () =>
                await session.InputAsync(Answer(first.RunId!, 1, "second tab")));
            Assert.That(duplicate!.StatusCode, Is.EqualTo(409));
            var staleFrame = await session.FrameAsync(Frame(first.RunId!, 1));
            Assert.That(staleFrame.Scene.TextInput, Is.Null);
            await session.InputAsync(new InputRequest { RunId = first.RunId!, Kind = "reset" });
            var events = await session.GetEventsAsync(first.RunId!);
            Assert.That(events[0].Text, Is.EqualTo("first tab"));
            Assert.That(events[1].Kind, Is.EqualTo("reset"));
            await session.FrameAsync(Frame(first.RunId!, 2));
            var stopped = await session.StopAsync();
            Assert.That(stopped.Scene.TextInput, Is.Null);
            var second = await session.RunAsync();
            await session.FrameAsync(Frame(second.RunId!, 1));
            var staleAnswer = Assert.ThrowsAsync<BlackPyException>(async () =>
                await session.InputAsync(Answer(first.RunId!, 1, "old run")));
            Assert.That(staleAnswer!.StatusCode, Is.EqualTo(409));
            await session.InputAsync(Answer(second.RunId!, 1, "new run"));
            Assert.That((await session.GetEventsAsync(second.RunId!))[0].Text, Is.EqualTo("new run"));
        }

        private static InputRequest Answer(string runId, int promptId, string? text) => new()
        {
            RunId = runId, Kind = "answer", PromptId = promptId, Text = text
        };

        private static SceneFrameRequest Frame(string runId, int promptId) => new()
        {
            RunId = runId,
            Scene = new SceneState
            {
                Message = "계속 움직여요",
                TextInput = new TextInputPrompt { Id = promptId, Message = "이름은?", Actor = "고양이" }
            }
        };

        private static void AssertStatus(int status, TestDelegate action) =>
            Assert.That(Assert.Throws<BlackPyException>(action)!.StatusCode, Is.EqualTo(status));
    }
}
