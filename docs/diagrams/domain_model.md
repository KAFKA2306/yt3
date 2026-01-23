# Domain Model Diagram

```mermaid
classDiagram
    class AgentState {
        +run_id: string
        +bucket: string
        +limit: number
        +status: string
    }

    class NewsItem {
        +title: string
        +summary: string
        +url: string
        +published_at: string
    }

    class DirectorData {
        +angle: string
        +title_hook: string
        +search_query: string
    }

    class Script {
        +title: string
        +description: string
        +total_duration: number
    }

    class ScriptLine {
        +speaker: string
        +text: string
        +duration: number
    }

    class Metadata {
        +title: string
        +thumbnail_title: string
        +description: string
        +tags: string[]
    }

    class PublishResults {
        +youtube: { status, video_id }
        +twitter: { status, tweet_id }
    }

    AgentState "1" o-- "0..*" NewsItem
    AgentState "1" o-- "0..1" DirectorData
    AgentState "1" o-- "0..1" Script
    AgentState "1" o-- "0..1" Metadata
    AgentState "1" o-- "0..1" PublishResults

    Script "1" *-- "0..*" ScriptLine
```
