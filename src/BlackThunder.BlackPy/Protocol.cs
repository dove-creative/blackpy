using System;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading.Channels;

namespace BlackThunder.BlackPy
{
    public class BlackPyException : Exception
    {
        public int StatusCode { get; }
        public BlackPyException(int statusCode, string message) : base(message) => StatusCode = statusCode;
    }

    public class CommandRequest
    {
        public string RunId { get; set; } = "";
        public string Command { get; set; } = "";
        public double[] Args { get; set; } = Array.Empty<double>();
    }

    public class OutputLine
    {
        public string Stream { get; }
        public string Text { get; }
        public OutputLine(string stream, string text) { Stream = stream; Text = text; }
    }

    public class StateMessage
    {
        public string Type { get; set; } = "snapshot";
        public string Status { get; set; } = "ready";
        public string? RunId { get; set; }
        public float X { get; set; }
        public float Y { get; set; }
        public double Heading { get; set; }
        public SceneState Scene { get; set; } = new();
        public string? Error { get; set; }
        [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
        public OutputLine[]? Output { get; set; }
        [JsonIgnore]
        public long OutputRevision { get; set; }

        public string Serialize(bool includeOutput) => JsonSerializer.Serialize(new StateMessage
        {
            Type = includeOutput ? "snapshot" : "state",
            Status = Status,
            RunId = RunId,
            X = X,
            Y = Y,
            Heading = Heading,
            Scene = Scene,
            Error = Error,
            Output = includeOutput ? Output : null
        }, JsonOptions);

        public static JsonSerializerOptions JsonOptions { get; } = new(JsonSerializerDefaults.Web);
    }

    public class BrowserConnection
    {
        public Guid Id { get; } = Guid.NewGuid();
        public Channel<StateMessage> Messages { get; } = Channel.CreateBounded<StateMessage>(
            new BoundedChannelOptions(1)
            {
                SingleReader = true,
                SingleWriter = true,
                FullMode = BoundedChannelFullMode.DropOldest
            });
    }
}
