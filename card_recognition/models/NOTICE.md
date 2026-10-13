# Evaluation model provenance

DocAligner T8 and LC100 were obtained from the official file IDs in
[infer.py](https://github.com/DocsaidLab/DocAligner/blob/3275b0f07f8e99d8c01cb0774dea2549be1416b6/docaligner/heatmap_reg/infer.py).
The upstream repository's Apache-2.0 license is reproduced in
`LICENSE-DocAligner.txt`. The manifest identifies this as the repository license;
no separate unpublished license for a checkpoint is inferred.

ONNX Runtime 1.30.0 uses the upstream MIT license reproduced in
`LICENSE-ONNX-Runtime.txt`, obtained from
[the version tag](https://github.com/microsoft/onnxruntime/blob/v1.30.0/LICENSE).
The exact npm runtime packages are pinned in the lockfile.

Downloaded bytes, SHA-256, ONNX checker metadata, upstream code hash and static
URLs are recorded in `manifest.json`. The binary weights and generated runtime
assets are not tracked. Numerical compatibility results live in the ignored
local evaluation directory and do not establish business-card detection quality.
No default production model has been selected.
