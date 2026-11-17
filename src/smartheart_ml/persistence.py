"""Save / load the .pth model bundles."""
import platform
import warnings
from datetime import datetime

import torch

ENSEMBLE_FORMAT = "smartheart/sklearn-ensemble-v1"
STUDENT_FORMAT = "smartheart/torch-mlp-student-v1"


def _versions():
    import sklearn
    return {"python": platform.python_version(), "torch": torch.__version__, "sklearn": sklearn.__version__}


def save_ensemble(path, model, meta):
    """The fitted scikit-learn pipeline is pickled inside the .pth (torch.save uses pickle).
    Loading therefore needs weights_only=False -> only load files you created yourself."""
    torch.save({"format": ENSEMBLE_FORMAT, "model": model, "created": datetime.now().isoformat(timespec="seconds"),
                "versions": _versions(), **meta}, path)


def save_student(path, model, encoder, arch, meta):
    """Pure tensors + plain Python types -> loadable with torch.load(weights_only=True)."""
    torch.save({"format": STUDENT_FORMAT, "state_dict": model.state_dict(), "arch": arch,
                "encoder": encoder.to_dict(), "created": datetime.now().isoformat(timespec="seconds"),
                "versions": _versions(), **meta}, path)


def load_bundle(path):
    # The student loads safely as plain tensors; the ensemble needs full unpickling.
    try:
        return torch.load(path, map_location="cpu", weights_only=True)
    except Exception:
        pass
    try:
        with warnings.catch_warnings():
            warnings.filterwarnings("ignore", message="Trying to unpickle estimator")
            b = torch.load(path, map_location="cpu", weights_only=False)
    except ModuleNotFoundError as e:
        raise RuntimeError(
            f"Cannot load {path}: Python package '{e.name}' is not installed in this environment. "
            "The ensemble must be loaded in the environment it was trained in (scikit-learn, xgboost, "
            "catboost). Activate that environment, e.g. gpu-env, and run again.") from None
    import sklearn
    saved = (b.get("versions") or {}).get("sklearn")
    if saved and saved != sklearn.__version__:
        warnings.warn(f"Model was saved with scikit-learn {saved} but this environment has {sklearn.__version__}. "
                      "Predictions may be wrong; run in the training environment.")
    return b