import datetime

from CTFd.models import db


class QAEvent(db.Model):
    __tablename__ = "qa_events"

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(128), nullable=False)
    description = db.Column(db.Text, default="")
    # Whether students can see this session
    is_active = db.Column(db.Boolean, default=True)
    # Whether new questions are accepted
    qa_open = db.Column(db.Boolean, default=True)
    created = db.Column(db.DateTime, default=datetime.datetime.utcnow)

    questions = db.relationship(
        "QAQuestion", backref="event", cascade="all, delete-orphan", lazy="dynamic"
    )
    polls = db.relationship(
        "QAPoll", backref="event", cascade="all, delete-orphan", lazy="dynamic"
    )


class QAQuestion(db.Model):
    __tablename__ = "qa_questions"

    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(
        db.Integer, db.ForeignKey("qa_events.id", ondelete="CASCADE"), index=True
    )
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"))
    content = db.Column(db.Text, nullable=False)
    is_anonymous = db.Column(db.Boolean, default=False)
    is_answered = db.Column(db.Boolean, default=False)
    is_pinned = db.Column(db.Boolean, default=False)
    is_hidden = db.Column(db.Boolean, default=False)
    created = db.Column(db.DateTime, default=datetime.datetime.utcnow)

    user = db.relationship("Users", foreign_keys=[user_id], lazy="joined")
    upvotes = db.relationship(
        "QAUpvote", backref="question", cascade="all, delete-orphan", lazy="select"
    )


class QAUpvote(db.Model):
    __tablename__ = "qa_upvotes"
    __table_args__ = (db.UniqueConstraint("question_id", "user_id"),)

    id = db.Column(db.Integer, primary_key=True)
    question_id = db.Column(
        db.Integer, db.ForeignKey("qa_questions.id", ondelete="CASCADE"), index=True
    )
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"))


class QAPoll(db.Model):
    __tablename__ = "qa_polls"

    STATES = ("draft", "open", "closed")

    id = db.Column(db.Integer, primary_key=True)
    event_id = db.Column(
        db.Integer, db.ForeignKey("qa_events.id", ondelete="CASCADE"), index=True
    )
    title = db.Column(db.Text, nullable=False)
    is_multiple = db.Column(db.Boolean, default=False)
    state = db.Column(db.String(16), default="draft")
    # Whether students can see the poll results
    show_results = db.Column(db.Boolean, default=False)
    created = db.Column(db.DateTime, default=datetime.datetime.utcnow)

    options = db.relationship(
        "QAPollOption",
        backref="poll",
        cascade="all, delete-orphan",
        order_by="QAPollOption.order",
        lazy="select",
    )
    votes = db.relationship(
        "QAPollVote", backref="poll", cascade="all, delete-orphan", lazy="select"
    )


class QAPollOption(db.Model):
    __tablename__ = "qa_poll_options"

    id = db.Column(db.Integer, primary_key=True)
    poll_id = db.Column(
        db.Integer, db.ForeignKey("qa_polls.id", ondelete="CASCADE"), index=True
    )
    text = db.Column(db.String(256), nullable=False)
    order = db.Column(db.Integer, default=0)


class QAPollVote(db.Model):
    __tablename__ = "qa_poll_votes"
    __table_args__ = (db.UniqueConstraint("option_id", "user_id"),)

    id = db.Column(db.Integer, primary_key=True)
    poll_id = db.Column(
        db.Integer, db.ForeignKey("qa_polls.id", ondelete="CASCADE"), index=True
    )
    option_id = db.Column(
        db.Integer, db.ForeignKey("qa_poll_options.id", ondelete="CASCADE")
    )
    user_id = db.Column(db.Integer, db.ForeignKey("users.id", ondelete="CASCADE"))
