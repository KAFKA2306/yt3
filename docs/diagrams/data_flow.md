# Data Flow Diagram

```mermaid
sequenceDiagram
    participant Start
    participant RA as ResearchAgent
    participant CA as ContentAgent
    participant MA as MediaAgent
    participant PA as PublishAgent
    participant MemA as MemoryAgent
    participant End

    Start->>RA: run(bucket, limit)
    rect rgb(200, 220, 240)
        note right of RA: Input: Topic/Bucket
        RA->>RA: Search News & Trends
        RA->>RA: Generate DirectorData
        RA-->>CA: return { director_data, news }
    end

    CA->>CA: Analyze News & Angle
    CA->>CA: Write Script
    CA->>CA: Generate Metadata
    CA-->>MA: return { script, metadata }

    rect rgb(220, 240, 200)
        MA->>MA: TTS Synthesis (Audio)
        MA->>MA: Layout Engine (Video Plan)
        MA->>MA: FFMPEG (Render Video)
        MA->>MA: Render Thumbnail
        MA-->>PA: return { video_path, thumbnail_path }
    end

    PA->>PA: Upload to YouTube
    PA->>PA: Post to Twitter
    PA-->>MemA: return { publish_results }

    MemA->>MemA: Update Long-term Memory
    MemA-->>End: return { status: "completed" }
```
