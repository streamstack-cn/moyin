"""备份 / 恢复：配置备份（用户与系统配置）与全部数据备份。"""

from __future__ import annotations

import json
import shutil
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from sqlalchemy.orm import Session

from database import DATA_DIR, IS_SQLITE, engine
from models import AppConfig, User, UserAiConfig
from version import APP_VERSION_LABEL, __version__

BackupType = Literal["config", "full"]

MANIFEST_NAME = "moyin_backup_manifest.json"
FORMAT_VERSION = 1


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _manifest(backup_type: BackupType, extra: dict[str, Any] | None = None) -> dict[str, Any]:
    data: dict[str, Any] = {
        "format": "moyin-backup",
        "format_version": FORMAT_VERSION,
        "type": backup_type,
        "app_version": __version__,
        "app_version_label": APP_VERSION_LABEL,
        "created_at": _utc_now_iso(),
    }
    if extra:
        data.update(extra)
    return data


def _checkpoint_sqlite() -> None:
    if not IS_SQLITE:
        return
    from sqlalchemy import text

    with engine.begin() as conn:
        conn.execute(text("PRAGMA wal_checkpoint(TRUNCATE)"))


def build_config_backup(db: Session) -> Path:
    """导出所有用户账号偏好、AI 配置与系统 AppConfig。"""
    users = db.query(User).order_by(User.created_at.asc()).all()
    ai_rows = db.query(UserAiConfig).all()
    configs = db.query(AppConfig).all()

    payload = {
        "users": [
            {
                "id": u.id,
                "username": u.username,
                "password_hash": u.password_hash,
                "display_name": u.display_name or "",
                "role": u.role or "reader",
                "disabled": bool(u.disabled),
                "created_by": u.created_by,
                "created_at": u.created_at.isoformat() if u.created_at else None,
                "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
                "preferences": u.preferences or "{}",
            }
            for u in users
        ],
        "user_ai_configs": [
            {
                "user_id": r.user_id,
                "base_url": r.base_url or "",
                "api_key": r.api_key or "",
                "model": r.model or "",
                "ai_portrait": r.ai_portrait or "{}",
                "output_lang": r.output_lang or "zh",
                "output_length": r.output_length or "standard",
            }
            for r in ai_rows
        ],
        "app_config": [{"key": c.key, "value": c.value or ""} for c in configs],
    }

    EXPORTS = DATA_DIR / "exports"
    EXPORTS.mkdir(parents=True, exist_ok=True)
    stamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    out = EXPORTS / f"moyin_config_backup_{stamp}.zip"
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            MANIFEST_NAME,
            json.dumps(
                _manifest(
                    "config",
                    {
                        "user_count": len(payload["users"]),
                        "app_config_count": len(payload["app_config"]),
                        "ai_config_count": len(payload["user_ai_configs"]),
                    },
                ),
                ensure_ascii=False,
                indent=2,
            ),
        )
        zf.writestr("config.json", json.dumps(payload, ensure_ascii=False, indent=2))
    return out


def build_full_backup() -> Path:
    """打包 /config 下数据库与媒体文件（全部数据）。"""
    if not IS_SQLITE:
        raise RuntimeError("当前为外部数据库模式，全部数据备份仅支持内置 SQLite")

    _checkpoint_sqlite()

    EXPORTS = DATA_DIR / "exports"
    EXPORTS.mkdir(parents=True, exist_ok=True)
    stamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    out = EXPORTS / f"moyin_full_backup_{stamp}.zip"

    skip_names = {".DS_Store", "exports"}
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            MANIFEST_NAME,
            json.dumps(_manifest("full", {"data_dir": str(DATA_DIR)}), ensure_ascii=False, indent=2),
        )
        for path in sorted(DATA_DIR.rglob("*")):
            if not path.is_file():
                continue
            rel = path.relative_to(DATA_DIR)
            parts = rel.parts
            if not parts:
                continue
            if parts[0] in skip_names or path.name in skip_names:
                continue
            # 避免把正在写的备份自己打进去
            if path.resolve() == out.resolve():
                continue
            zf.write(path, arcname=str(rel).replace("\\", "/"))
    return out


def inspect_backup_zip(zip_path: Path) -> dict[str, Any]:
    """识别备份类型；兼容旧版无 manifest 的整目录 zip（视为 full）。"""
    if not zipfile.is_zipfile(zip_path):
        raise ValueError("不是有效的 zip 备份文件")

    with zipfile.ZipFile(zip_path, "r") as zf:
        names = set(zf.namelist())
        manifest: dict[str, Any] | None = None
        if MANIFEST_NAME in names:
            try:
                manifest = json.loads(zf.read(MANIFEST_NAME).decode("utf-8"))
            except Exception as exc:
                raise ValueError(f"无法读取备份清单：{exc}") from exc

        if manifest and manifest.get("format") == "moyin-backup":
            btype = manifest.get("type")
            if btype not in ("config", "full"):
                raise ValueError(f"未知备份类型：{btype}")
            return {
                "type": btype,
                "type_label": "配置备份" if btype == "config" else "全部数据备份",
                "app_version": manifest.get("app_version_label") or manifest.get("app_version") or "",
                "created_at": manifest.get("created_at") or "",
                "format_version": manifest.get("format_version"),
                "has_manifest": True,
                "user_count": manifest.get("user_count"),
                "app_config_count": manifest.get("app_config_count"),
                "ai_config_count": manifest.get("ai_config_count"),
            }

        # 旧版：直接打包 DATA_DIR
        has_db = any(n.rstrip("/").endswith("moyin.db") or n == "moyin.db" for n in names)
        has_config_json = "config.json" in names
        if has_config_json and not has_db:
            return {
                "type": "config",
                "type_label": "配置备份",
                "app_version": "",
                "created_at": "",
                "has_manifest": False,
            }
        if has_db:
            return {
                "type": "full",
                "type_label": "全部数据备份（旧版格式）",
                "app_version": "",
                "created_at": "",
                "has_manifest": False,
            }
        raise ValueError("无法识别备份类型：既不是配置备份，也不含完整数据库")


def restore_config_backup(db: Session, zip_path: Path) -> dict[str, Any]:
    with zipfile.ZipFile(zip_path, "r") as zf:
        if "config.json" not in zf.namelist():
            raise ValueError("配置备份缺少 config.json")
        payload = json.loads(zf.read("config.json").decode("utf-8"))

    users_data = payload.get("users") or []
    ai_data = payload.get("user_ai_configs") or []
    configs = payload.get("app_config") or []

    restored_users = 0
    for item in users_data:
        username = (item.get("username") or "").strip()
        if not username:
            continue
        uid = item.get("id") or ""
        row = db.query(User).filter(User.id == uid).first() if uid else None
        if not row:
            row = db.query(User).filter(User.username == username).first()
        if row:
            row.username = username
            row.password_hash = item.get("password_hash") or row.password_hash
            row.display_name = item.get("display_name") or ""
            row.role = item.get("role") or row.role
            row.disabled = bool(item.get("disabled", False))
            row.preferences = item.get("preferences") or "{}"
        else:
            password_hash = item.get("password_hash") or ""
            if not password_hash:
                continue
            kwargs: dict[str, Any] = {
                "username": username,
                "password_hash": password_hash,
                "display_name": item.get("display_name") or "",
                "role": item.get("role") or "reader",
                "disabled": bool(item.get("disabled", False)),
                "created_by": item.get("created_by"),
                "preferences": item.get("preferences") or "{}",
            }
            if uid:
                kwargs["id"] = uid
            db.add(User(**kwargs))
        restored_users += 1

    db.flush()

    restored_ai = 0
    for item in ai_data:
        uid = item.get("user_id")
        if not uid or not db.query(User).filter(User.id == uid).first():
            continue
        row = db.query(UserAiConfig).filter(UserAiConfig.user_id == uid).first()
        if not row:
            row = UserAiConfig(user_id=uid)
            db.add(row)
        row.base_url = item.get("base_url") or row.base_url
        row.api_key = item.get("api_key") if item.get("api_key") is not None else row.api_key
        row.model = item.get("model") or row.model
        row.ai_portrait = item.get("ai_portrait") or "{}"
        row.output_lang = item.get("output_lang") or "zh"
        row.output_length = item.get("output_length") or "standard"
        restored_ai += 1

    restored_cfg = 0
    for item in configs:
        key = (item.get("key") or "").strip()
        if not key:
            continue
        row = db.query(AppConfig).filter_by(key=key).first()
        if row:
            row.value = item.get("value") or ""
        else:
            db.add(AppConfig(key=key, value=item.get("value") or ""))
        restored_cfg += 1

    db.commit()
    return {
        "type": "config",
        "users": restored_users,
        "user_ai_configs": restored_ai,
        "app_config": restored_cfg,
    }


def restore_full_backup(zip_path: Path) -> dict[str, Any]:
    if not IS_SQLITE:
        raise RuntimeError("当前为外部数据库模式，无法用 zip 恢复全部数据")

    _checkpoint_sqlite()
    engine.dispose()

    with tempfile.TemporaryDirectory(prefix="moyin_restore_") as tmp:
        tmp_path = Path(tmp)
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(tmp_path)

        # 兼容：清单与文件在根目录，或套了一层目录
        root = tmp_path
        if not (root / "moyin.db").exists():
            candidates = [p for p in root.iterdir() if p.is_dir()]
            for c in candidates:
                if (c / "moyin.db").exists():
                    root = c
                    break
        if not (root / "moyin.db").exists():
            raise ValueError("全部数据备份中未找到 moyin.db")

        # 先替换数据库
        dest_db = DATA_DIR / "moyin.db"
        for suffix in ("", "-wal", "-shm"):
            p = DATA_DIR / f"moyin.db{suffix}"
            if p.exists():
                p.unlink()
        shutil.copy2(root / "moyin.db", dest_db)

        for dirname in ("covers", "uploads", "converted"):
            src = root / dirname
            dest = DATA_DIR / dirname
            if dest.exists():
                shutil.rmtree(dest)
            if src.exists() and src.is_dir():
                shutil.copytree(src, dest)
            else:
                dest.mkdir(parents=True, exist_ok=True)

    from database import init_db

    init_db()
    return {"type": "full", "message": "全部数据已恢复，请刷新页面；若异常可重启容器"}


def restore_backup(db: Session, zip_path: Path) -> dict[str, Any]:
    info = inspect_backup_zip(zip_path)
    if info["type"] == "config":
        result = restore_config_backup(db, zip_path)
    else:
        result = restore_full_backup(zip_path)
    result["detected"] = info
    return result
