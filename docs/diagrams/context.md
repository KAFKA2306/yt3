# System Context Diagram

flowchart TB
    Creator["Content Creator\nOperates the system to generate videos"]
    
    subgraph SystemBoundary ["2511YouTuber"]
        System["Automated Video Generation System\nOrchestrates research, content creation, media synthesis, and publishing"]
    end

    subgraph External ["External Systems"]
        YouTube["YouTube\nVideo Hosting Platform"]
        Twitter["Twitter-X\nSocial Media Platform"]
        Gemini["Google Gemini\nLLM Provider"]
        VoiceVox["VoiceVox\nTTS Engine"]
        News["News Sources\nVarious News Websites"]
    end

    Creator -->|"Runs workflows CLI"| System
    System -->|"Generates content decisions API"| Gemini
    System -->|"Synthesizes speech API"| VoiceVox
    System -->|"Fetches news HTTP"| News
    System -->|"Uploads videos API"| YouTube
    System -->|"Posts updates API"| Twitter
