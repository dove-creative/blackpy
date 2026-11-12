using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace BlackThunder.BlackPy
{
    public class InputRequest
    {
        public string RunId { get; set; } = "";
        public string Kind { get; set; } = "";
        public string Button { get; set; } = "";
        public string Key { get; set; } = "";
        public double X { get; set; }
        public double Y { get; set; }
        public int PromptId { get; set; }
        public string? Text { get; set; }
    }

    public class InputEvent
    {
        public string Kind { get; }
        public string Button { get; }
        public string Key { get; }
        public double X { get; }
        public double Y { get; }
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
        public int PromptId { get; }
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public string? Text { get; }
        public long Generation { get; internal set; }
        public string? TargetId { get; internal set; }

        public InputEvent(InputRequest request)
        {
            Kind = request.Kind;
            Button = request.Button;
            Key = request.Key;
            X = request.X;
            Y = request.Y;
            PromptId = request.PromptId;
            Text = request.Text;
        }
    }

    /// <summary>Bounds input pending for one Python run on the runtime owner thread.</summary>
    public class InputController
    {
        // Front
        public int Count => _events.Count;

        // Internal
        private const int Capacity = 128;
        private const int BatchSize = 32;
        private static readonly HashSet<string> _keys = new(StringComparer.Ordinal)
        {
            "왼쪽", "오른쪽", "위", "아래", "스페이스", "엔터", "탈출"
        };
        private readonly LinkedList<InputEvent> _events = new();
        private string? _runId;
        private int _lastAnsweredPromptId;


        // Content
        public void BeginRun(string runId)
        {
            _events.Clear();
            _runId = runId;
            _lastAnsweredPromptId = 0;
        }

        public void EndRun()
        {
            _runId = null;
            _events.Clear();
        }

        public bool HasAnsweredPrompt(int promptId) => promptId > 0 && promptId <= _lastAnsweredPromptId;

        public InputEvent Submit(InputRequest request, int? activePromptId = null)
        {
            RequireRun(request.RunId);
            Validate(request);
            if (request.Kind == "answer"
                && (request.PromptId != activePromptId || HasAnsweredPrompt(request.PromptId)))
                throw new BlackPyException(409, "이미 답했거나 다른 질문의 입력입니다.");

            var input = new InputEvent(request);

            // Losing focus must release held keys without discarding accepted answers.
            if (input.Kind == "reset")
            {
                var node = _events.First;
                while (node != null)
                {
                    var next = node.Next;
                    if (node.Value.Kind != "answer") _events.Remove(node);
                    node = next;
                }
            }

            if (input.Kind == "pointermove" && _events.Last?.Value.Kind == "pointermove")
            {
                _events.Last.Value = input;
                return input;
            }

            // Reserve one slot so a reset can always follow retained answers.
            var capacity = input.Kind == "answer" ? Capacity - 1 : Capacity;
            if (_events.Count >= capacity && (input.Kind == "keyup" || input.Kind == "pointerup"))
            {
                // Releases must still revoke server-owned motion when the event queue is full.
                var node = _events.First;
                while (node != null && node.Value.Kind == "answer") node = node.Next;
                if (node != null) _events.Remove(node);
            }
            if (_events.Count >= capacity)
                throw new BlackPyException(429, "입력이 많이 쌓였습니다. 잠시 뒤 다시 눌러 주세요.");

            _events.AddLast(input);
            if (input.Kind == "answer") _lastAnsweredPromptId = input.PromptId;
            return input;
        }

        public InputEvent[] Drain(string runId)
        {
            RequireRun(runId);
            var batch = new InputEvent[Math.Min(_events.Count, BatchSize)];

            for (int i = 0; i < batch.Length; i++)
            {
                batch[i] = _events.First!.Value;
                _events.RemoveFirst();
            }

            return batch;
        }

        private void RequireRun(string runId)
        {
            if (_runId == null || _runId != runId)
                throw new BlackPyException(409, "끝났거나 다른 실행의 입력입니다.");
        }

        private static void Validate(InputRequest request)
        {
            if (!double.IsFinite(request.X) || request.X < -400 || request.X > 400
                || !double.IsFinite(request.Y) || request.Y < -300 || request.Y > 300)
                throw new BlackPyException(400, "입력 위치는 무대 안의 좌표여야 합니다.");
            if (request.Key == null || request.Button == null)
                throw new BlackPyException(400, "입력 이름을 확인해 주세요.");

            switch (request.Kind)
            {
                case "pointerdown":
                case "pointerup":
                    if (request.Button != "왼쪽")
                        throw new BlackPyException(400, "마우스 왼쪽 버튼을 사용해 주세요.");
                    if (request.Key.Length != 0)
                        throw new BlackPyException(400, "클릭에는 키 이름을 넣지 않습니다.");
                    break;
                case "keydown":
                case "keyup":
                    if (!_keys.Contains(request.Key) && !(request.Key.Length == 1
                        && request.Key[0] >= '!' && request.Key[0] <= '~'
                        && !(request.Key[0] >= 'A' && request.Key[0] <= 'Z')))
                        throw new BlackPyException(400, "지원하는 키 이름을 사용해 주세요.");
                    if (request.Button.Length != 0)
                        throw new BlackPyException(400, "키 입력에는 마우스 버튼을 넣지 않습니다.");
                    break;
                case "pointermove":
                case "reset":
                    if (request.Button.Length != 0 || request.Key.Length != 0)
                        throw new BlackPyException(400, "이 입력에는 버튼이나 키 이름을 넣지 않습니다.");
                    break;
                case "answer":
                    if (request.PromptId <= 0 || request.Text == null || request.Text.Length > 4096
                        || request.Text.Contains('\r') || request.Text.Contains('\n'))
                        throw new BlackPyException(400, "답은 한 줄로 4096자까지 입력해 주세요.");
                    if (request.Button.Length != 0 || request.Key.Length != 0)
                        throw new BlackPyException(400, "답에는 버튼이나 키 이름을 넣지 않습니다.");
                    break;
                default:
                    throw new BlackPyException(400, "지원하지 않는 입력 종류입니다.");
            }
        }
    }
}
