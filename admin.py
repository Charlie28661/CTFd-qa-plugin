from flask import Blueprint, render_template
from sqlalchemy import func

from CTFd.models import db
from CTFd.utils.decorators import admins_only

from .models import QAEvent, QAPoll, QAPollOption, QAQuestion
from .utils import admin_state, error, get_json, invalidate_event, ok, serialize_event

qa_admin = Blueprint("qa_admin", __name__, template_folder="templates")

POLL_MAX_OPTIONS = 10


def _bool_fields(obj, data, fields):
    for field in fields:
        if field in data:
            setattr(obj, field, bool(data[field]))


# ---------- Pages ----------


@qa_admin.route("/admin/qa")
@admins_only
def events_page():
    events = QAEvent.query.order_by(QAEvent.id.desc()).all()
    question_counts = dict(
        db.session.query(QAQuestion.event_id, func.count(QAQuestion.id))
        .group_by(QAQuestion.event_id)
        .all()
    )
    return render_template(
        "qa_admin_events.html", events=events, question_counts=question_counts
    )


@qa_admin.route("/admin/qa/<int:event_id>")
@admins_only
def event_page(event_id):
    event = QAEvent.query.get_or_404(event_id)
    return render_template("qa_admin_event.html", event=event)


@qa_admin.route("/admin/qa/<int:event_id>/present")
@admins_only
def present_page(event_id):
    event = QAEvent.query.get_or_404(event_id)
    return render_template("qa_present.html", event=event)


# ---------- Sessions ----------


@qa_admin.route("/admin/qa/api/events", methods=["POST"])
@admins_only
def create_event():
    data = get_json()
    title = str(data.get("title") or "").strip()
    if not title:
        return error("Please enter a session title")
    event = QAEvent(
        title=title[:128],
        description=str(data.get("description") or "").strip(),
        is_active=bool(data.get("is_active", True)),
        qa_open=bool(data.get("qa_open", True)),
    )
    db.session.add(event)
    db.session.commit()
    return ok(serialize_event(event))


@qa_admin.route("/admin/qa/api/events/<int:event_id>", methods=["PATCH"])
@admins_only
def update_event(event_id):
    event = QAEvent.query.get_or_404(event_id)
    data = get_json()
    if "title" in data:
        title = str(data["title"] or "").strip()
        if not title:
            return error("Please enter a session title")
        event.title = title[:128]
    if "description" in data:
        event.description = str(data["description"] or "").strip()
    _bool_fields(event, data, ("is_active", "qa_open"))
    db.session.commit()
    invalidate_event(event.id)
    return ok(serialize_event(event))


@qa_admin.route("/admin/qa/api/events/<int:event_id>", methods=["DELETE"])
@admins_only
def delete_event(event_id):
    event = QAEvent.query.get_or_404(event_id)
    db.session.delete(event)
    db.session.commit()
    invalidate_event(event_id)
    return ok()


@qa_admin.route("/admin/qa/api/events/<int:event_id>/state")
@admins_only
def event_state(event_id):
    return ok(admin_state(QAEvent.query.get_or_404(event_id)))


# ---------- Questions ----------


@qa_admin.route("/admin/qa/api/questions/<int:question_id>", methods=["PATCH"])
@admins_only
def update_question(question_id):
    question = QAQuestion.query.get_or_404(question_id)
    _bool_fields(question, get_json(), ("is_answered", "is_pinned", "is_hidden"))
    db.session.commit()
    invalidate_event(question.event_id)
    return ok()


@qa_admin.route("/admin/qa/api/questions/<int:question_id>", methods=["DELETE"])
@admins_only
def delete_question(question_id):
    question = QAQuestion.query.get_or_404(question_id)
    event_id = question.event_id
    db.session.delete(question)
    db.session.commit()
    invalidate_event(event_id)
    return ok()


# ---------- Polls ----------


@qa_admin.route("/admin/qa/api/events/<int:event_id>/polls", methods=["POST"])
@admins_only
def create_poll(event_id):
    event = QAEvent.query.get_or_404(event_id)
    data = get_json()
    title = str(data.get("title") or "").strip()
    if not title:
        return error("Please enter a poll question")
    options = [
        str(o).strip()[:256] for o in (data.get("options") or []) if str(o).strip()
    ]
    if len(options) < 2:
        return error("At least two options are required")
    if len(options) > POLL_MAX_OPTIONS:
        return error("At most {} options are allowed".format(POLL_MAX_OPTIONS))

    state = data.get("state", "draft")
    if state not in QAPoll.STATES:
        return error("Invalid state")

    poll = QAPoll(
        event_id=event.id,
        title=title,
        is_multiple=bool(data.get("is_multiple")),
        state=state,
        show_results=bool(data.get("show_results")),
    )
    poll.options = [QAPollOption(text=t, order=i) for i, t in enumerate(options)]
    db.session.add(poll)
    db.session.commit()
    invalidate_event(event.id)
    return ok({"id": poll.id})


@qa_admin.route("/admin/qa/api/polls/<int:poll_id>", methods=["PATCH"])
@admins_only
def update_poll(poll_id):
    poll = QAPoll.query.get_or_404(poll_id)
    data = get_json()
    if "state" in data:
        if data["state"] not in QAPoll.STATES:
            return error("Invalid state")
        poll.state = data["state"]
    _bool_fields(poll, data, ("show_results",))
    db.session.commit()
    invalidate_event(poll.event_id)
    return ok()


@qa_admin.route("/admin/qa/api/polls/<int:poll_id>/reset", methods=["POST"])
@admins_only
def reset_poll(poll_id):
    poll = QAPoll.query.get_or_404(poll_id)
    poll.votes = []
    db.session.commit()
    invalidate_event(poll.event_id)
    return ok()


@qa_admin.route("/admin/qa/api/polls/<int:poll_id>", methods=["DELETE"])
@admins_only
def delete_poll(poll_id):
    poll = QAPoll.query.get_or_404(poll_id)
    event_id = poll.event_id
    db.session.delete(poll)
    db.session.commit()
    invalidate_event(event_id)
    return ok()
