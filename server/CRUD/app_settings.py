from typing import Optional

from sqlalchemy.orm import Session

from ..models.models import AppSetting

CONTAINER_RUNTIME_GLOBAL_DEFAULTS_KEY = "container_runtime_global_defaults"


def get_setting_json(db: Session, setting_key: str) -> Optional[dict]:
    setting = db.query(AppSetting).filter(AppSetting.setting_key == setting_key).first()
    if not setting:
        return None
    if not isinstance(setting.setting_value, dict):
        return None
    return setting.setting_value


def set_setting_json(db: Session, setting_key: str, value: dict) -> dict:
    setting = db.query(AppSetting).filter(AppSetting.setting_key == setting_key).first()

    if not setting:
        setting = AppSetting(setting_key=setting_key, setting_value=value)
        db.add(setting)
    else:
        setting.setting_value = value  # type: ignore

    db.commit()
    db.refresh(setting)
    return setting.setting_value


def get_container_runtime_global_defaults(db: Session) -> Optional[dict]:
    return get_setting_json(db, CONTAINER_RUNTIME_GLOBAL_DEFAULTS_KEY)


def set_container_runtime_global_defaults(db: Session, value: dict) -> dict:
    return set_setting_json(db, CONTAINER_RUNTIME_GLOBAL_DEFAULTS_KEY, value)
