using System;
using System.Collections.Generic;

namespace BlackThunder.BlackPy
{
    public class SceneFrameRequest
    {
        public string RunId { get; set; } = "";
        public SceneState Scene { get; set; } = null!;
    }

    public class SceneState
    {
        public bool Active { get; set; }
        public string Background { get; set; } = "plain";
        public SpriteState[] Sprites { get; set; } = Array.Empty<SpriteState>();
        public string Message { get; set; } = "";
        public TextInputPrompt? TextInput { get; set; }
    }

    public class TextInputPrompt
    {
        public int Id { get; set; }
        public string Message { get; set; } = "";
        public string Actor { get; set; } = "";
    }

    public class SpriteState
    {
        public string Id { get; set; } = "";
        public string Kind { get; set; } = "cat";
        public double X { get; set; }
        public double Y { get; set; }
        public double Width { get; set; } = 70;
        public double Height { get; set; } = 70;
        public double Heading { get; set; }
        public string Color { get; set; } = "#ffb347";
        public bool Visible { get; set; } = true;
        public bool FlipHorizontal { get; set; }
        public bool FlipVertical { get; set; }
        public string Label { get; set; } = "";
        public string Speech { get; set; } = "";
    }

    /// <summary>Owns the latest Python animation frame on the runtime's single simulation thread.</summary>
    public class SceneController
    {
        // Front
        public SceneState State { get; private set; } = new();

        // Internal
        private static readonly HashSet<string> _backgrounds = new(StringComparer.Ordinal)
        {
            "plain", "city", "dance", "track", "court", "forest"
        };
        private static readonly HashSet<string> _kinds = new(StringComparer.Ordinal)
        {
            "cat", "car", "rabbit", "ball", "bat", "ghost", "star", "basket", "paddle", "rocket", "flag", "planet"
        };
        private string? _runId;


        // Content --------------------
        // Run lifetime
        public static bool IsBackgroundKind(string kind) => kind != null && _backgrounds.Contains(kind);
        public static bool IsActorKind(string kind) => kind != null && _kinds.Contains(kind);

        public void BeginRun(string runId)
        {
            _runId = runId;
            State = new SceneState();
        }

        public void Submit(SceneFrameRequest request)
        {
            if (_runId == null || request.RunId != _runId)
                throw new BlackPyException(409, "끝났거나 다른 실행의 장면입니다.");

            State = CopyValidated(request.Scene);
        }

        public void ClearTextInput()
        {
            if (State.TextInput == null) return;

            State = new SceneState
            {
                Active = State.Active,
                Background = State.Background,
                Sprites = State.Sprites,
                Message = State.Message
            };
        }

        public void EndRun()
        {
            _runId = null;
            ClearTextInput();
        }

        // Frame validation
        internal static SceneState CopyValidated(SceneState scene)
        {
            if (scene == null || scene.Background == null || !_backgrounds.Contains(scene.Background))
                throw Invalid("준비된 배경 이름을 사용해 주세요.");
            if (scene.Message == null || scene.Message.Length > 200)
                throw Invalid("장면 안내는 200자까지 사용할 수 있습니다.");
            if (scene.Sprites == null || scene.Sprites.Length > 64)
                throw Invalid("한 장면에는 캐릭터를 64개까지 놓을 수 있습니다.");

            var prompt = scene.TextInput;
            if (prompt != null && (prompt.Id <= 0 || prompt.Message == null || prompt.Message.Length > 2000
                || prompt.Actor == null || prompt.Actor.Length > 80))
                throw Invalid("입력 질문은 올바른 번호와 2000자 이하의 안내, 80자 이하의 대상 이름이 필요합니다.");

            var sprites = new SpriteState[scene.Sprites.Length];
            var ids = new HashSet<string>(StringComparer.Ordinal);

            for (int i = 0; i < sprites.Length; i++)
            {
                var sprite = scene.Sprites[i];
                if (sprite == null || string.IsNullOrWhiteSpace(sprite.Id) || sprite.Id.Length > 64)
                    throw Invalid("캐릭터 이름은 1자부터 64자까지 필요합니다.");
                if (!ids.Add(sprite.Id)) throw Invalid("장면 안의 캐릭터 이름은 서로 달라야 합니다.");
                if (sprite.Kind == null || !_kinds.Contains(sprite.Kind))
                    throw Invalid("준비된 캐릭터 모양을 사용해 주세요.");
                if (sprite.Label == null || sprite.Label.Length > 80)
                    throw Invalid("캐릭터 설명은 80자까지 사용할 수 있습니다.");
                if (sprite.Speech == null || sprite.Speech.Length > 200)
                    throw Invalid("말풍선은 200자까지 사용할 수 있습니다.");
                if (!ValidColor(sprite.Color)) throw Invalid("색은 #으로 시작하는 여섯 자리 색상 코드로 적어 주세요.");

                ValidateNumber(sprite.X, -100000, 100000, "가로 위치");
                ValidateNumber(sprite.Y, -100000, 100000, "세로 위치");
                ValidateNumber(sprite.Width, 1, 2000, "가로 크기");
                ValidateNumber(sprite.Height, 1, 2000, "세로 크기");
                ValidateNumber(sprite.Heading, -1000000, 1000000, "회전 각도");
                sprites[i] = new SpriteState
                {
                    Id = sprite.Id,
                    Kind = sprite.Kind,
                    X = sprite.X,
                    Y = sprite.Y,
                    Width = sprite.Width,
                    Height = sprite.Height,
                    Heading = sprite.Heading,
                    Color = sprite.Color,
                    Visible = sprite.Visible,
                    FlipHorizontal = sprite.FlipHorizontal,
                    FlipVertical = sprite.FlipVertical,
                    Label = sprite.Label,
                    Speech = sprite.Speech
                };
            }

            return new SceneState
            {
                Active = true,
                Background = scene.Background,
                Sprites = sprites,
                Message = scene.Message,
                TextInput = prompt == null ? null : new TextInputPrompt
                {
                    Id = prompt.Id,
                    Message = prompt.Message,
                    Actor = prompt.Actor
                }
            };
        }

        private static bool ValidColor(string color)
        {
            if (color == null || color.Length != 7 || color[0] != '#') return false;

            for (int i = 1; i < color.Length; i++)
            {
                var digit = color[i];
                if (!(digit >= '0' && digit <= '9' || digit >= 'a' && digit <= 'f'
                    || digit >= 'A' && digit <= 'F')) return false;
            }

            return true;
        }

        private static void ValidateNumber(double value, double minimum, double maximum, string label)
        {
            if (!double.IsFinite(value) || value < minimum || value > maximum)
                throw Invalid(label + "에 사용할 수 있는 범위의 숫자를 넣어 주세요.");
        }

        private static BlackPyException Invalid(string message) => new(400, message);
    }
}
