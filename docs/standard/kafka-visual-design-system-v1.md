<!-- GENERATED FROM config/design/kafka_visual_system_v1.json. Do not edit numeric values here. -->
# Kafka Visual Design System v1

唯一の正本は [kafka_visual_system_v1.json](../../config/design/kafka_visual_system_v1.json) です。renderer はこの JSON を read-only で参照します。

## Canvas

| Surface | Width | Height | FPS |
| --- | ---: | ---: | ---: |
| Landscape | 1920 | 1080 | 30 |
| Shorts | 1080 | 1920 | 30 |
| Thumbnail | 1280 | 720 | — |

## Landscape geometry

| Region | x | y | width | height |
| --- | ---: | ---: | ---: | ---: |
| Outer frame | 32 | 32 | 1856 | 1016 |
| Caption band | 0 | 856 | 1920 | 224 |
| Data region | 96 | 504 | 1296 | 224 |
| Character region | 1424 | 208 | 400 | 648 |
| Source baseline | 96 | 824 | 1296 | — |

## Thumbnail and Shorts geometry

| Surface | Region | x | y | width | height |
| --- | --- | ---: | ---: | ---: | ---: |
| Thumbnail | Title | 64 | 144 | 760 | 408 |
| Thumbnail | Character | 832 | 56 | 384 | 608 |
| Shorts | Main visual | 72 | 200 | 864 | 1120 |
| Shorts | Caption band | 0 | 1416 | 1080 | 264 |

## Motion

`{"scene_fade_in_frames":3,"content_drift_amplitude_px":1.2,"content_drift_period_frames":114,"background_gradient_angle_deg":135,"transition_zoom":0,"max_simultaneous_animations":2}`
