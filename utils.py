import functools
import time

from flask import jsonify, request
from sqlalchemy import func
from sqlalchemy.orm import selectinload

from CTFd.cache import cache
from CTFd.models import db
from CTFd.utils.user import get_current_user

from .models import QAPoll, QAPollVote, QAQuestion, QAUpvote

QUESTION_MAX_LENGTH = 300
ANONYMOUS_NAME = "Anonymous"

# Every write invalidates the cached state explicitly; the TTL only bounds staleness
# if an invalidation is ever missed (e.g. a cache backend that isn't shared by workers).
STATE_CACHE_TTL = 3


def error(message, status=400):
    return jsonify({"success": False, "message": message}), status


def ok(data=None):
    return jsonify({"success": True, "data": data})


def get_json():
    return request.get_json(silent=True) or {}


def user_ratelimit(limit, interval, key_prefix="qa"):
    """Fixed-window rate limit keyed by user instead of IP.

    CTFd's built-in ratelimit keys on IP address. In a classroom the whole class
    usually shares one NAT IP and would exhaust each other's quota, so this keys
    on the user id instead. The window index is part of the key, so each window
    starts from zero no matter how steadily the user keeps making requests.
    """

    def decorator(f):
        @functools.wraps(f)
        def wrapper(*args, **kwargs):
            user = get_current_user()
            window = int(time.time() // interval)
            key = "{}:{}:{}:{}".format(key_prefix, request.endpoint, user.id, window)
            current = cache.get(key) or 0
            if current >= limit:
                return error("Too many requests, please slow down", 429)
            cache.set(key, current + 1, timeout=interval)
            return f(*args, **kwargs)

        return wrapper

    return decorator


def iso(dt):
    return dt.isoformat() + "Z" if dt else None


def serialize_event(event):
    return {
        "id": event.id,
        "title": event.title,
        "description": event.description or "",
        "is_active": event.is_active,
        "qa_open": event.qa_open,
        "created": iso(event.created),
    }


# ---------- Shared (viewer-independent) state ----------


def _state_key(event_id):
    return "qa:state:{}".format(event_id)


def invalidate_event(event_id):
    cache.delete(_state_key(event_id))


def build_questions(event_id, include_hidden):
    """Questions with upvote counts and real author info, sorted for display.

    Contains user ids and names, so callers must strip them before sending
    anything to students.
    """
    query = QAQuestion.query.filter_by(event_id=event_id)
    if not include_hidden:
        query = query.filter_by(is_hidden=False)
    questions = query.all()

    counts = dict(
        db.session.query(QAUpvote.question_id, func.count(QAUpvote.id))
        .join(QAQuestion, QAQuestion.id == QAUpvote.question_id)
        .filter(QAQuestion.event_id == event_id)
        .group_by(QAUpvote.question_id)
        .all()
    )

    result = [
        {
            "id": q.id,
            "content": q.content,
            "is_anonymous": q.is_anonymous,
            "is_answered": q.is_answered,
            "is_pinned": q.is_pinned,
            "is_hidden": q.is_hidden,
            "upvotes": counts.get(q.id, 0),
            "user_id": q.user_id,
            "user_name": q.user.name if q.user else "(deleted user)",
            "created": iso(q.created),
        }
        for q in questions
    ]
    # Pinned > unanswered > most upvotes > newest (sort by time first, then rely on stable sort for the other keys)
    result.sort(key=lambda i: i["id"], reverse=True)
    result.sort(key=lambda i: (not i["is_pinned"], i["is_answered"], -i["upvotes"]))
    return result


def build_polls(event_id, include_all):
    """Polls with full results, using a fixed number of queries regardless of poll count."""
    query = QAPoll.query.filter_by(event_id=event_id).options(
        selectinload(QAPoll.options)
    )
    if not include_all:
        # Students see open polls, plus closed polls whose results are published
        query = query.filter(
            db.or_(
                QAPoll.state == "open",
                db.and_(QAPoll.state == "closed", QAPoll.show_results.is_(True)),
            )
        )
    polls = query.order_by(QAPoll.id.desc()).all()

    ids = [p.id for p in polls]
    counts = {}
    voters = {}
    if ids:
        counts = dict(
            db.session.query(QAPollVote.option_id, func.count(QAPollVote.id))
            .filter(QAPollVote.poll_id.in_(ids))
            .group_by(QAPollVote.option_id)
            .all()
        )
        voters = dict(
            db.session.query(
                QAPollVote.poll_id, func.count(func.distinct(QAPollVote.user_id))
            )
            .filter(QAPollVote.poll_id.in_(ids))
            .group_by(QAPollVote.poll_id)
            .all()
        )

    return [
        {
            "id": p.id,
            "title": p.title,
            "is_multiple": p.is_multiple,
            "state": p.state,
            "show_results": p.show_results,
            "options": [
                {"id": o.id, "text": o.text, "votes": counts.get(o.id, 0)}
                for o in p.options
            ],
            "voters": voters.get(p.id, 0),
            "created": iso(p.created),
        }
        for p in polls
    ]


# ---------- Per-viewer state ----------


def student_state(event, viewer_id):
    """State for a student: the cached shared part plus a small per-viewer overlay."""
    shared = cache.get(_state_key(event.id))
    if shared is None:
        shared = {
            "questions": build_questions(event.id, include_hidden=False),
            "polls": build_polls(event.id, include_all=False),
        }
        cache.set(_state_key(event.id), shared, timeout=STATE_CACHE_TTL)

    upvoted = {
        row[0]
        for row in db.session.query(QAUpvote.question_id)
        .join(QAQuestion, QAQuestion.id == QAUpvote.question_id)
        .filter(QAQuestion.event_id == event.id, QAUpvote.user_id == viewer_id)
        .all()
    }
    my_votes = {}
    for poll_id, option_id in (
        db.session.query(QAPollVote.poll_id, QAPollVote.option_id)
        .join(QAPoll, QAPoll.id == QAPollVote.poll_id)
        .filter(QAPoll.event_id == event.id, QAPollVote.user_id == viewer_id)
        .all()
    ):
        my_votes.setdefault(poll_id, []).append(option_id)

    # Whitelist fields explicitly: the shared data holds real names and user ids
    questions = [
        {
            "id": q["id"],
            "content": q["content"],
            "is_anonymous": q["is_anonymous"],
            "is_answered": q["is_answered"],
            "is_pinned": q["is_pinned"],
            "upvotes": q["upvotes"],
            "upvoted_by_me": q["id"] in upvoted,
            "is_mine": q["user_id"] == viewer_id,
            "author": ANONYMOUS_NAME if q["is_anonymous"] else q["user_name"],
            "created": q["created"],
        }
        for q in shared["questions"]
    ]

    polls = []
    for p in shared["polls"]:
        visible = p["show_results"]
        poll = {
            "id": p["id"],
            "title": p["title"],
            "is_multiple": p["is_multiple"],
            "state": p["state"],
            "show_results": p["show_results"],
            "results_visible": visible,
            "options": [
                dict(o) if visible else {"id": o["id"], "text": o["text"]}
                for o in p["options"]
            ],
            "my_votes": my_votes.get(p["id"], []),
            "created": p["created"],
        }
        if visible:
            poll["voters"] = p["voters"]
        polls.append(poll)

    return {"event": serialize_event(event), "questions": questions, "polls": polls}


def admin_state(event):
    questions = build_questions(event.id, include_hidden=True)
    for q in questions:
        q["author"] = q["user_name"]
        q["upvoted_by_me"] = False
        q["is_mine"] = False
    polls = build_polls(event.id, include_all=True)
    for p in polls:
        p["results_visible"] = True
        p["my_votes"] = []
    return {"event": serialize_event(event), "questions": questions, "polls": polls}
