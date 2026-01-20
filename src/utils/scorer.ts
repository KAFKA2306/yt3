
/**
 * Simple novelty checker to avoid repeating recent topics
 */

export interface PastVideo {
    topic: string;
    angle: string;
    date: string;
}

/**
 * Check if a topic is too similar to recent content
 * Returns true if the topic is novel enough to proceed
 */
export function isNovelTopic(topic: string, pastVideos: PastVideo[], minDays: number = 7): boolean {
    const now = new Date();
    const topicLower = topic.toLowerCase();
    const topicWords = new Set(topicLower.split(/\s+/).filter(w => w.length > 2));

    for (const past of pastVideos) {
        const pastDate = new Date(past.date);
        const daysSince = (now.getTime() - pastDate.getTime()) / (1000 * 60 * 60 * 24);

        // Only check recent videos
        if (daysSince > minDays) continue;

        const pastWords = new Set(past.topic.toLowerCase().split(/\s+/).filter(w => w.length > 2));
        const overlap = [...topicWords].filter(w => pastWords.has(w)).length;
        const similarity = overlap / Math.max(topicWords.size, 1);

        // If >50% word overlap with recent video, reject
        if (similarity > 0.5) {
            console.log(`[Novelty] Topic "${topic}" too similar to recent "${past.topic}" (${Math.round(similarity * 100)}%)`);
            return false;
        }
    }

    return true;
}

/**
 * Get list of recent topics to avoid (for prompt injection)
 */
export function getRecentTopicsNote(pastVideos: PastVideo[], maxDays: number = 14): string {
    const now = new Date();
    const recent = pastVideos.filter(v => {
        const daysSince = (now.getTime() - new Date(v.date).getTime()) / (1000 * 60 * 60 * 24);
        return daysSince <= maxDays;
    });

    if (recent.length === 0) return "なし";

    return recent.map(v => `- ${v.topic} (${v.angle})`).join("\n");
}
