# Deployment Diagram

flowchart TB
    subgraph LocalMachine ["User Local Machine"]
        subgraph NodeRuntime ["Node.js Runtime"]
            CLI["CLI Application"]
        end
        subgraph FS ["File System"]
            Store["Asset Store"]
            Code["Source Code"]
        end
    end

    subgraph Cloud ["Google Cloud"]
        Gemini["Gemini API"]
    end

    subgraph VoiceEngine ["VoiceVox Engine"]
        VV["VoiceVox Service"]
    end

    CLI -->|"HTTPS JSON"| Gemini
    CLI -->|"HTTP JSON"| VV
    CLI -->|"File IO"| Store
    CLI -->|"Reads"| Code
