import os
import json
import sys
import torch
import librosa
from speechbrain.inference.speaker import EncoderClassifier
import numpy as np

def main():
    manifest_path = sys.argv[1]
    audio_dir = os.path.dirname(manifest_path)

    with open(manifest_path, 'r') as f:
        manifest = json.load(f)

    classifier = EncoderClassifier.from_hparams(source="speechbrain/spkrec-ecapa-voxceleb")

    speaker_embeddings = {} 

    for chunk in manifest.get('chunks', []):
        speaker = chunk.get('script_speaker') or chunk.get('speaker')
        audio_path = chunk.get('output_path') or os.path.join(audio_dir, chunk.get('filename', ''))
        
        if not speaker or not audio_path or not os.path.exists(audio_path):
            continue
        
        try:
            # Load with librosa, resample to 16kHz
            signal, fs = librosa.load(audio_path, sr=16000)
            # Convert to torch tensor
            signal = torch.from_numpy(signal).unsqueeze(0)
            
            embeddings = classifier.encode_batch(signal)
            embedding = embeddings.squeeze().detach().cpu().numpy()
            
            if speaker not in speaker_embeddings:
                speaker_embeddings[speaker] = []
            speaker_embeddings[speaker].append(embedding)
        except Exception as e:
            print(f"DEBUG: Error processing {audio_path}: {str(e)}", file=sys.stderr)
            continue

    speakers = list(speaker_embeddings.keys())
    centroids = {spk: np.mean(speaker_embeddings[spk], axis=0) for spk in speakers}

    def cosine_similarity(a, b):
        return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))

    distance_matrix = {}
    collisions = []
    
    for i in range(len(speakers)):
        s1 = speakers[i]
        distance_matrix[s1] = {}
        for j in range(len(speakers)):
            s2 = speakers[j]
            sim = float(cosine_similarity(centroids[s1], centroids[s2]))
            distance_matrix[s1][s2] = sim
            if i < j and sim > 0.85:
                collisions.append({"speakers": [s1, s2], "similarity": sim, "type": "VOICE_COLLAPSE"})

    print(json.dumps({
        "status": "success",
        "speakers": speakers,
        "distance_matrix": distance_matrix,
        "collisions": collisions,
        "summary": {"total_speakers": len(speakers), "detected_collisions": len(collisions)}
    }))

if __name__ == "__main__":
    main()
