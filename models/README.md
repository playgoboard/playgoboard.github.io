# Dragon's neural network

`dragon-b10c128.onnx` is KataGo's network **g170e-b10c128-s1141046784-d204142634**
(https://github.com/lightvector/KataGo/releases/tag/v1.3), converted to ONNX with
`tools/katago_to_onnx.py --fp16` (weights stored as float16, math in float32).

License: KataGo's g170 networks are released under **CC0** (public domain), see
https://katagotraining.org/network_license/ . Thank you to David J Wu (lightvector) and
everyone who contributed to KataGo.

The conversion was checked against the official KataGo program (`kata-raw-nn`) on 9x9,
13x13 and 19x19 positions, including ladders: win chances, score leads and move chances
match to about 3-4 decimal places.
