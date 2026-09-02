
@router.post("/report/{report_id}/evolve/stream")
async def evolve_report_stream(
    report_id: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """流式升级报告，将对话融入原报告"""
    report = db.query(AiReadingReport).filter(
        AiReadingReport.id == report_id,
        AiReadingReport.user_id == user.id,
    ).first()
    if not report:
        raise HTTPException(404, "报告不存在")

    try:
        report_data = json.loads(report.report_json)
    except Exception:
        raise HTTPException(400, "原报告格式错误，无法升级")

    try:
        chat_messages = json.loads(report.chat_history or "[]")
    except Exception:
        chat_messages = []

    if not chat_messages:
        raise HTTPException(400, "没有对话历史，无需升级")

    cfg = _get_or_create_config(user.id, db)
    ai_cfg = _require_ai_config(cfg)

    system_prompt = _build_evolve_system_prompt(cfg)
    user_prompt = _build_evolve_user_prompt(report_data, chat_messages)
    messages = [{"role": "user", "content": user_prompt}]

    full_content: list[str] = []

    async def event_generator():
        try:
            async for chunk in chat_completion_stream(messages, ai_cfg, system_prompt):
                full_content.append(chunk)
                yield f"data: {json.dumps({'content': chunk}, ensure_ascii=False)}\n\n"

            complete = "".join(full_content)
            try:
                clean = complete.strip()
                if clean.startswith("```"):
                    clean = clean.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
                new_report_data = json_repair.loads(clean)
            except Exception:
                new_report_data = {"raw": complete}

            # 重新查一下报告避免会话过期
            db_report = db.query(AiReadingReport).filter(AiReadingReport.id == report_id).first()
            if db_report:
                db_report.report_json = json.dumps(new_report_data, ensure_ascii=False)
                db_report.chat_history = "[]" # 清空已融入的对话
                db_report.version = (db_report.version or 1) + 1
                from datetime import datetime
                db_report.updated_at = datetime.utcnow()
                db.commit()

            yield "data: [DONE]\n\n"
        except Exception as e:
            err = str(e)
            logger.error(f"[AI伴读] 升级报告失败: {err}")
            yield f"data: {json.dumps({'error': err}, ensure_ascii=False)}\n\n"
            yield "data: [DONE]\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
