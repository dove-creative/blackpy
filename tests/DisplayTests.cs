using System;
using System.IO;
using System.Text.Json.Nodes;
using BlackThunder.BlackPy;
using NUnit.Framework;

namespace BlackThunder.BlackPy.Tests
{
    [TestFixture]
    public class DisplayTests
    {
        [Test]
        public void BindingPersistsWithoutScriptsAndPreservesOtherConfiguration()
        {
            using var project = new ProjectTestDirectory();
            project.Definition.Displays = new[] { new DisplayDefinition { Name = "점수판", Y = 200 } };
            project.SaveDefinition();
            var support = Path.Combine(project.Path, "_blackpy");
            Directory.CreateDirectory(support);
            var filename = Path.Combine(support, "project.json");
            File.Move(Path.Combine(project.Path, "project.json"), filename);
            var root = JsonNode.Parse(File.ReadAllText(filename))!;
            root["teacherNote"] = "보존";
            File.WriteAllText(filename, root.ToJsonString());
            var sources = ProjectLoader.ReadSnapshot(project.Path).Sources;
            ProjectLoader.BindDisplay(project.Path, new DisplayBindingRequest { Name = "점수판", Variable = " 동전_수 " });
            var saved = ProjectLoader.ReadSnapshot(project.Path);
            Assert.That(saved.Project.Displays[0].Variable, Is.EqualTo("동전_수"));
            Assert.That(saved.Project.Displays[0].Y, Is.EqualTo(200));
            Assert.That(saved.Sources.Length, Is.EqualTo(sources.Length));
            Assert.That(saved.Sources[1].Source, Is.EqualTo(sources[1].Source));
            Assert.That(JsonNode.Parse(File.ReadAllText(filename))!["teacherNote"]!.GetValue<string>(), Is.EqualTo("보존"));
            ProjectLoader.BindDisplay(project.Path, new DisplayBindingRequest { Name = "점수판", Variable = "" });
            Assert.That(ProjectLoader.ReadDefinition(project.Path).Displays[0].Variable, Is.Empty);
        }

        [TestCase("점수 + 1")]
        [TestCase("1점수")]
        [TestCase("global")]
        [TestCase("__blackpy_globals__")]
        [TestCase("점수\n다른값")]
        [TestCase(null)]
        public void InvalidBindingDoesNotChangeTheFile(string? variable)
        {
            using var project = new ProjectTestDirectory();
            project.Definition.Displays = new[] { new DisplayDefinition { Name = "점수판" } };
            project.SaveDefinition();
            var filename = Path.Combine(project.Path, "project.json");
            var original = File.ReadAllBytes(filename);
            Assert.That(Assert.Throws<BlackPyException>(() => ProjectLoader.BindDisplay(project.Path,
                new DisplayBindingRequest { Name = "점수판", Variable = variable! }))!.StatusCode, Is.EqualTo(400));
            Assert.That(File.ReadAllBytes(filename), Is.EqualTo(original));
        }

        [Test]
        public void DisplayDefinitionsRejectDuplicateNamesAndInvalidScale()
        {
            using var project = new ProjectTestDirectory();
            var display = new DisplayDefinition { Name = "고양이" };
            project.Definition.Displays = new[] { display };
            project.SaveDefinition();
            Assert.Throws<BlackPyException>(() => ProjectLoader.ReadDefinition(project.Path));
            display.Name = "점수판";
            display.Scale = 0;
            project.SaveDefinition();
            Assert.Throws<BlackPyException>(() => ProjectLoader.ReadDefinition(project.Path));
        }

        [Test]
        public void DisplayFramesAreCopiedAndRetainedWhenInputOrRunEnds()
        {
            var scene = new SceneController();
            scene.BeginRun("run");
            var display = new DisplayState { Name = "점수판", Variable = "점수", Text = "3" };
            scene.Submit(new SceneFrameRequest
            {
                RunId = "run", Scene = new SceneState
                {
                    Displays = new[] { display }, TextInput = new TextInputPrompt { Id = 1 },
                },
            });
            display.Text = "999";
            scene.EndRun();
            Assert.That(scene.State.Displays[0].Text, Is.EqualTo("3"));
            scene.SetDisplays(new[] { new DisplayDefinition { Name = "점수판", Variable = "다른_점수" } });
            Assert.That(scene.State.Displays[0].Text, Is.EqualTo("—"));
            scene.BeginRun("next");
            Assert.That(scene.State.Displays, Is.Empty);
        }

        [Test]
        public void DisplayTextLimitCountsUnicodeCharacters()
        {
            var scene = new SceneController();
            scene.BeginRun("run");
            var text = string.Concat(System.Linq.Enumerable.Repeat("⭐😀", 100));
            var display = new DisplayState { Name = "표시", Text = text };
            var request = new SceneFrameRequest { RunId = "run", Scene = new SceneState { Displays = new[] { display } } };
            scene.Submit(request);
            Assert.That(scene.State.Displays[0].Text, Is.EqualTo(text));
            display.Text += "가";
            Assert.Throws<BlackPyException>(() => scene.Submit(request));
        }
    }
}
