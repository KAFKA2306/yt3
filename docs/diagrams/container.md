# Container Diagram

flowchart TB
    Creator["Content Creator\nOperates the system"]

    subgraph System ["2511YouTuber System"]
        CLI["CLI Application\nNode.js, TypeScript"]
        Workflow["Workflow Engine\nLangGraph"]
        Agents["Agents\nTypeScript Classes"]
        FStore["File System\nLocal Disk"]
    end

    subgraph External ["External Systems"]
        Gemini["Google Gemini\nLLM Provider"]
        VoiceVox["VoiceVox\nTTS Engine"]
        YouTube["YouTube\nVideo Platform"]
    end

    Creator -->|"Runs commands"| CLI
    CLI -->|"Initializes and runs"| Workflow
    Workflow -->|"Invokes"| Agents
    Agents -->|"Reads-Writes assets state"| FStore
    Agents -->|"Inference API"| Gemini
    Agents -->|"Synthesis API"| VoiceVox
    Agents -->|"Publish API"| YouTube
