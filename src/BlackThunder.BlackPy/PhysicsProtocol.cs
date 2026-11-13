using System;

namespace BlackThunder.BlackPy
{
    public class PhysicsStepRequest
    {
        public string RunId { get; set; } = "";
        public double DeltaTime { get; set; }
        public PhysicsActorState[] Actors { get; set; } = Array.Empty<PhysicsActorState>();
        public PhysicsCommand[] Commands { get; set; } = Array.Empty<PhysicsCommand>();
    }

    public class PhysicsActorState
    {
        public string Id { get; set; } = "";
        public double X { get; set; }
        public double Y { get; set; }
        public double Heading { get; set; }
        public bool Trigger { get; set; }
        public double Width { get; set; }
        public double Height { get; set; }
        public string Mode { get; set; } = "충돌만";
        public double Mass { get; set; } = 1;
        public bool Visible { get; set; } = true;
    }

    public class PhysicsCommand
    {
        public string Id { get; set; } = "";
        public string Kind { get; set; } = "";
        public string Mode { get; set; } = "";
        public bool Trigger { get; set; }
        public double Rotation { get; set; }
        public double Forward { get; set; }
        public double X { get; set; }
        public double Y { get; set; }
    }

    public class PhysicsStepResult
    {
        public PhysicsActorResult[] Actors { get; set; } = Array.Empty<PhysicsActorResult>();
    }

    public class PhysicsActorResult
    {
        public string Id { get; set; } = "";
        public double X { get; set; }
        public double Y { get; set; }
        public double Heading { get; set; }
        public string[] Contacts { get; set; } = Array.Empty<string>();
    }
}
