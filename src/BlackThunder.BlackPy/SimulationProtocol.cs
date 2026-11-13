using System;
using System.Collections.Generic;

namespace BlackThunder.BlackPy
{
    public class SimulationExchangeRequest
    {
        public string RunId { get; set; } = "";
        public long Sequence { get; set; }
        public bool Ready { get; set; }
        public SceneState Scene { get; set; } = null!;
        public PhysicsActorState[] Actors { get; set; } = Array.Empty<PhysicsActorState>();
        public SimulationCommand[] Commands { get; set; } = Array.Empty<SimulationCommand>();
        public string[] AcknowledgedCompletions { get; set; } = Array.Empty<string>();
        public long ContactAck { get; set; }
    }

    public class SimulationCommand : PhysicsCommand
    {
        public string Token { get; set; } = "";
        public double Duration { get; set; }
        public string Source { get; set; } = "";
        public long Generation { get; set; }
        public long Revision { get; set; }
    }

    public class SimulationActorResult : PhysicsActorResult
    {
        public long ContactGeneration { get; set; }
    }

    public class SimulationContactEvent
    {
        public long Sequence { get; set; }
        public string Id { get; set; } = "";
        public string Kind { get; set; } = "";
        public string[] Others { get; set; } = Array.Empty<string>();
    }

    public class SimulationExchangeResult
    {
        public long Tick { get; set; }
        public double Elapsed { get; set; }
        public SimulationActorResult[] Actors { get; set; } = Array.Empty<SimulationActorResult>();
        public string[] Completed { get; set; } = Array.Empty<string>();
        public SimulationContactEvent[] Contacts { get; set; } = Array.Empty<SimulationContactEvent>();
        public InputEvent[] Events { get; set; } = Array.Empty<InputEvent>();
        public Dictionary<string, long> Keys { get; set; } = new(StringComparer.Ordinal);
        public string? PointerId { get; set; }
        public long PointerGeneration { get; set; }
    }
}
