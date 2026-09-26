from flask import Blueprint, abort, render_template
from sqlalchemy.exc import IntegrityError

from CTFd.models import Users, db
from CTFd.utils.decorators import authed_only
from CTFd.utils.user import get_current_user

from .models import (
    QAEvent,
    QAPoll,
    QAPollOption,
    QAPollVote,
    QAQuestion,
    QAUpvote,
)
from .utils import (
    QUESTION_MAX_LENGTH,
    error,
    get_json,
    invalidate_event,
    ok,
    student_state,
    user_ratelimit,
)

qa = Blueprint("qa", __name__, template_folder="templates")


def get_visible_event_or_404(event_id):
    event = QAEvent.query.filter_by(id=event_id, is_active=True).first()
    if event is None:
        abort(404)
    return event


# ---------- Pages ----------


@qa.route("/qa")
@authed_only
def index():
    events = (
        QAEvent.query.filter_by(is_active=True).order_by(QAEvent.id.desc()).all()
    )
    return render_template("qa_index.html", events=events)


@qa.route("/qa/<int:event_id>")
@authed_only
def event_page(event_id):
    event = get_visible_event_or_404(event_id)
    return render_template(
        "qa_event.html", event=event, max_length=QUESTION_MAX_LENGTH
    )


# ---------- Student API ----------


@qa.route("/qa/api/events/<int:event_id>/state")
@authed_only
def event_state(event_id):
    event = get_visible_event_or_404(event_id)
    return ok(student_state(event, get_current_user().id))


@qa.route("/qa/api/events/<int:event_id>/questions", methods=["POST"])
@authed_only
@user_ratelimit(limit=10, interval=60)
def create_question(event_id):
    event = get_visible_event_or_404(event_id)
    if not event.qa_open:
        return error("Questions are closed", 403)

    data = get_json()
    content = str(data.get("content") or "").strip()
    if not content:
        return error("Question cannot be empty")
    if len(content) > QUESTION_MAX_LENGTH:
        return error("Questions are limited to {} characters".format(QUESTION_MAX_LENGTH))

    user = get_current_user()
    question = QAQuestion(
        event_id=event.id,
        user_id=user.id,
        content=content,
        is_anonymous=bool(data.get("anonymous")),
    )
    db.session.add(question)
    db.session.commit()
    invalidate_event(event.id)
    return ok({"id": question.id})


@qa.route("/qa/api/questions/<int:question_id>", methods=["DELETE"])
@authed_only
def delete_question(question_id):
    user = get_current_user()
    question = QAQuestion.query.filter_by(id=question_id, user_id=user.id).first()
    if question is None:
        return error("Question not found", 404)
    event_id = question.event_id
    db.session.delete(question)
    db.session.commit()
    invalidate_event(event_id)
    return ok()


@qa.route("/qa/api/questions/<int:question_id>/upvote", methods=["POST"])
@authed_only
@user_ratelimit(limit=60, interval=60)
def toggle_upvote(question_id):
    question = QAQuestion.query.filter_by(id=question_id, is_hidden=False).first()
    if question is None or not question.event.is_active:
        return error("Question not found", 404)

    user = get_current_user()
    if question.user_id == user.id:
        return error("You cannot upvote your own question")

    existing = QAUpvote.query.filter_by(
        question_id=question.id, user_id=user.id
    ).first()
    if existing:
        db.session.delete(existing)
        upvoted = False
    else:
        db.session.add(QAUpvote(question_id=question.id, user_id=user.id))
        upvoted = True
    try:
        db.session.commit()
    except IntegrityError:
        # A rapid double click raced into a duplicate insert; treat it as upvoted
        db.session.rollback()
        upvoted = True
    invalidate_event(question.event_id)
    return ok({"upvoted": upvoted})


@qa.route("/qa/api/polls/<int:poll_id>/vote", methods=["POST"])
@authed_only
@user_ratelimit(limit=30, interval=60)
def vote(poll_id):
    poll = QAPoll.query.filter_by(id=poll_id).first()
    if poll is None or not poll.event.is_active:
        return error("Poll not found", 404)
    if poll.state != "open":
        return error("This poll is not open", 403)

    data = get_json()
    try:
        option_ids = {int(i) for i in (data.get("option_ids") or [])}
    except (TypeError, ValueError):
        return error("Invalid option format")
    if not option_ids:
        return error("Please select at least one option")
    if not poll.is_multiple and len(option_ids) > 1:
        return error("This poll allows only one choice")

    valid_ids = {
        row[0]
        for row in db.session.query(QAPollOption.id).filter_by(poll_id=poll.id).all()
    }
    if not option_ids <= valid_ids:
        return error("Option does not exist")

    # Votes can be changed: clear the previous vote, then write the new one.
    # Lock the user's row first so two concurrent votes from the same user (two
    # devices, a double click) run one after the other instead of both deleting
    # nothing and inserting different options into a single-choice poll.
    user = get_current_user()
    Users.query.filter_by(id=user.id).with_for_update().first()
    QAPollVote.query.filter_by(poll_id=poll.id, user_id=user.id).delete()
    for option_id in option_ids:
        db.session.add(
            QAPollVote(poll_id=poll.id, option_id=option_id, user_id=user.id)
        )
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return error("Vote conflict, please try again", 409)
    invalidate_event(poll.event_id)
    return ok({"my_votes": sorted(option_ids)})
