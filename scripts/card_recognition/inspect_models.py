import hashlib
import json
from pathlib import Path
import shutil

import onnx

root = Path("output/card-rectification/models")
manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
for entry in manifest["models"]:
    path = root / entry["localFile"]
    assert hashlib.sha256(path.read_bytes()).hexdigest() == entry["sha256"]
    model = onnx.load(str(path))
    onnx.checker.check_model(model)
    def tensors(values):
        return [{"name": v.name, "shape": [d.dim_value or d.dim_param for d in v.type.tensor_type.shape.dim],
                 "elementType": onnx.TensorProto.DataType.Name(v.type.tensor_type.elem_type)} for v in values]
    entry["inspectedInputs"] = tensors(model.graph.input)
    entry["inspectedOutputs"] = tensors(model.graph.output)
    entry["opsets"] = [{"domain": v.domain, "version": v.version} for v in model.opset_import]
    entry["status"] = "INTEGRITY_VERIFIED_RUNTIME_NOT_RUN"
    entry["staticUrl"] = f"/models/{entry['id']}/{entry['sha256']}/model.onnx"
manifest["runtimeVersion"] = "1.30.0"
manifest["inspectionTool"] = f"onnx {onnx.__version__}"
destination = Path("card_recognition/models")
destination.mkdir(parents=True, exist_ok=True)
(destination / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
shutil.copyfile(root / "LICENSE-DocAligner.txt", destination / "LICENSE-DocAligner.txt")
print(json.dumps({"inspected": len(manifest["models"]), "status": "PASS: integrity only"}))
