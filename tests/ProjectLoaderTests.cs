using System;
using System.IO;
using System.Text;
using System.Text.Json;
using BlackThunder.BlackPy;
using NUnit.Framework;

namespace BlackThunder.BlackPy.Tests
{
    [TestFixture]
    public class ProjectLoaderTests
    {
        [Test]
        public void SnapshotRetainsEverySourceAndDefinitionUntilReadAgain()
        {
            using var project = new ProjectTestDirectory();
            var original = Encoding.UTF8.GetBytes("# 한국어\ndef 시작():\n    앞으로(100)\n");
            File.WriteAllBytes(Path.Combine(project.Path, "고양이.py"), original);
            var first = ProjectLoader.ReadSnapshot(project.Path);
            File.WriteAllText(Path.Combine(project.Path, "고양이.py"), "# 바뀐 코드\n");
            project.Definition.Actors[0].X = 200;
            project.SaveDefinition();
            var second = ProjectLoader.ReadSnapshot(project.Path);

            Assert.That(first.Sources.Length, Is.EqualTo(2));
            Assert.That(first.Sources[0].Filename, Is.EqualTo(Path.Combine(project.Path, "배경.py")));
            Assert.That(Convert.FromBase64String(first.Sources[1].Source), Is.EqualTo(original));
            Assert.That(first.Project.Actors[0].X, Is.Zero);
            Assert.That(second.Project.Actors[0].X, Is.EqualTo(200));
            Assert.That(second.Sources[1].Source, Is.Not.EqualTo(first.Sources[1].Source));
            using var json = JsonDocument.Parse(JsonSerializer.Serialize(first, StateMessage.JsonOptions));
            Assert.That(json.RootElement.GetProperty("sources").GetArrayLength(), Is.EqualTo(2));
            Assert.That(json.RootElement.GetProperty("project").GetProperty("actors")[0]
                .GetProperty("speed").GetDouble(), Is.EqualTo(1));
        }

        [TestCase("../outside.py")]
        [TestCase("sub/actor.py")]
        [TestCase("sub\\actor.py")]
        [TestCase("C:\\outside.py")]
        [TestCase("actor.txt")]
        [TestCase(".py")]
        public void OnlyTopLevelPythonFilenamesAreAccepted(string file)
        {
            using var project = new ProjectTestDirectory();
            project.Definition.Actors[0].File = file;
            project.SaveDefinition();
            AssertStatus(400, () => ProjectLoader.ReadSnapshot(project.Path));
        }

        [Test]
        public void Utf8BomConfigurationAndSourceAreSupported()
        {
            using var project = new ProjectTestDirectory();
            var encoding = new UTF8Encoding(true);
            File.WriteAllText(Path.Combine(project.Path, "project.json"),
                JsonSerializer.Serialize(project.Definition, StateMessage.JsonOptions), encoding);
            File.WriteAllText(Path.Combine(project.Path, "고양이.py"), "# 한국어\n", encoding);
            var snapshot = ProjectLoader.ReadSnapshot(project.Path);
            Assert.That(snapshot.Project.Actors[0].Name, Is.EqualTo("고양이"));
            Assert.That(Convert.FromBase64String(snapshot.Sources[1].Source),
                Is.EqualTo(File.ReadAllBytes(Path.Combine(project.Path, "고양이.py"))));
        }

        [Test]
        public void DuplicateNamesAndCaseInsensitiveFilesAreRejected()
        {
            using var project = new ProjectTestDirectory();
            project.Definition.Actors = new[]
            {
                new ActorDefinition { Name = "고양이", File = "cat.py" },
                new ActorDefinition { Name = "자동차", File = "CAT.py", Kind = "car" }
            };
            project.SaveDefinition();
            AssertStatus(400, () => ProjectLoader.ReadDefinition(project.Path));
            project.Definition.Actors[1].File = "car.py";
            project.Definition.Actors[1].Name = "고양이";
            project.SaveDefinition();
            AssertStatus(400, () => ProjectLoader.ReadDefinition(project.Path));
            project.Definition.Actors[1].Name = "배경";
            project.SaveDefinition();
            AssertStatus(400, () => ProjectLoader.ReadDefinition(project.Path));
        }

        [Test]
        public void InvalidConfigurationAndMissingScriptsHaveActionableErrors()
        {
            using var project = new ProjectTestDirectory();
            File.Delete(Path.Combine(project.Path, "고양이.py"));
            Assert.That(Assert.Throws<BlackPyException>(() => ProjectLoader.ReadSnapshot(project.Path))!.Message,
                Does.Contain("고양이.py"));
            File.WriteAllText(Path.Combine(project.Path, "project.json"), "{");
            AssertStatus(400, () => ProjectLoader.ReadDefinition(project.Path));
            File.WriteAllText(Path.Combine(project.Path, "project.json"), "null");
            AssertStatus(400, () => ProjectLoader.ReadDefinition(project.Path));
            File.Delete(Path.Combine(project.Path, "project.json"));
            Assert.That(Assert.Throws<BlackPyException>(() => ProjectLoader.ReadDefinition(project.Path))!.Message,
                Does.Contain("이전 main.py"));
        }

        [TestCase(0)]
        [TestCase(-1)]
        public void NonPositiveSpeedIsRejected(double speed)
        {
            using var project = new ProjectTestDirectory();
            project.Definition.Actors[0].Speed = speed;
            project.SaveDefinition();
            AssertStatus(400, () => ProjectLoader.ReadDefinition(project.Path));
        }

        [Test]
        public void InvalidShapesAndOutOfRangeStateAreRejected()
        {
            using var project = new ProjectTestDirectory();
            project.Definition.Background.Kind = "unknown";
            project.SaveDefinition();
            AssertStatus(400, () => ProjectLoader.ReadDefinition(project.Path));
            project.Definition.Background.Kind = "plain";
            project.Definition.Actors[0].Kind = "unknown";
            project.SaveDefinition();
            AssertStatus(400, () => ProjectLoader.ReadDefinition(project.Path));
            project.Definition.Actors[0].Kind = "cat";
            project.Definition.Actors[0].Scale = 0;
            project.SaveDefinition();
            AssertStatus(400, () => ProjectLoader.ReadDefinition(project.Path));
            project.Definition.Actors[0].Scale = 1;
            project.Definition.Actors[0].X = 100001;
            project.SaveDefinition();
            AssertStatus(400, () => ProjectLoader.ReadDefinition(project.Path));
        }

        private static void AssertStatus(int status, TestDelegate action) =>
            Assert.That(Assert.Throws<BlackPyException>(action)!.StatusCode, Is.EqualTo(status));
    }

    internal class ProjectTestDirectory : IDisposable
    {
        public string Path { get; } = System.IO.Path.Combine(
            System.IO.Path.GetTempPath(), "BlackPyProjectTests-" + Guid.NewGuid().ToString("N"));
        public ProjectDefinition Definition { get; } = new()
        {
            Background = new BackgroundDefinition { File = "배경.py" },
            Actors = new[] { new ActorDefinition { Name = "고양이", File = "고양이.py" } }
        };

        public ProjectTestDirectory()
        {
            Directory.CreateDirectory(Path);
            File.WriteAllText(System.IO.Path.Combine(Path, "배경.py"), "# 배경\n");
            File.WriteAllText(System.IO.Path.Combine(Path, "고양이.py"), "# 고양이\n");
            SaveDefinition();
        }

        public void SaveDefinition() => File.WriteAllText(
            System.IO.Path.Combine(Path, "project.json"), JsonSerializer.Serialize(Definition, StateMessage.JsonOptions));

        public void Dispose() => Directory.Delete(Path, true);

        public static PythonCommand PassivePython(PythonCommand python, string body = "import time; time.sleep(60)") =>
            new(python.Executable, "-c", "import sys; sys.stdin.buffer.read(1); sys.stdin.buffer.readline(); " + body);
    }
}
