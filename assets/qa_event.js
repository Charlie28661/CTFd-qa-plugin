/* Student page: Q&A + polls */
(function () {
  "use strict";

  var S = window.CTFdQA;
  var el = S.el;
  var app = document.getElementById("qa-app");
  var eventId = app.dataset.eventId;
  var maxLength = parseInt(app.dataset.maxLength, 10);

  var state = null;
  var lastJson = "";
  var sortMode = "popular";
  // Unsubmitted selections in poll forms: {pollId: [optionId...]}
  var drafts = {};

  // ---------- Tabs ----------
  var TAB_KEY = "qa-tab-" + eventId;
  function showTab(name) {
    app.querySelectorAll(".qa-tab").forEach(function (t) {
      t.classList.toggle("active", t.dataset.tab === name);
    });
    app.querySelectorAll(".qa-panel").forEach(function (p) {
      p.hidden = p.dataset.panel !== name;
    });
    try {
      sessionStorage.setItem(TAB_KEY, name);
    } catch (e) {}
  }
  app.querySelectorAll(".qa-tab").forEach(function (t) {
    t.addEventListener("click", function () {
      showTab(t.dataset.tab);
    });
  });
  try {
    if (sessionStorage.getItem(TAB_KEY) === "polls") showTab("polls");
  } catch (e) {}

  // ---------- Ask ----------
  var form = document.getElementById("qa-ask");
  var content = document.getElementById("qa-ask-content");
  var anonymous = document.getElementById("qa-ask-anonymous");
  var counter = document.getElementById("qa-ask-counter");
  var submit = document.getElementById("qa-ask-submit");

  content.addEventListener("input", function () {
    counter.textContent = content.value.length + " / " + maxLength;
  });
  content.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) form.requestSubmit();
  });

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var text = content.value.trim();
    if (!text) return;
    submit.disabled = true;
    S.api("POST", "/qa/api/events/" + eventId + "/questions", {
      content: text,
      anonymous: anonymous.checked,
    })
      .then(function () {
        content.value = "";
        counter.textContent = "0 / " + maxLength;
        S.toast("Question sent");
        poller.refresh();
      })
      .catch(function (err) {
        S.toast(err.message, "error");
      })
      .then(function () {
        submit.disabled = false;
      });
  });

  // ---------- Sorting ----------
  app.querySelectorAll(".qa-sort-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      sortMode = b.dataset.sort;
      app.querySelectorAll(".qa-sort-btn").forEach(function (x) {
        x.classList.toggle("active", x === b);
      });
      renderQuestions();
    });
  });

  // ---------- Question list ----------
  function upvote(q) {
    S.api("POST", "/qa/api/questions/" + q.id + "/upvote")
      .then(function () { poller.refresh(); })
      .catch(function (err) {
        S.toast(err.message, "error");
      });
  }

  function remove(q) {
    if (!confirm("Delete this question?")) return;
    S.api("DELETE", "/qa/api/questions/" + q.id)
      .then(function () { poller.refresh(); })
      .catch(function (err) {
        S.toast(err.message, "error");
      });
  }

  function questionCard(q) {
    var badges = [];
    if (q.is_pinned) badges.push(el("span", { class: "qa-badge qa-badge-blue", text: "Pinned" }));
    if (q.is_answered) badges.push(el("span", { class: "qa-badge qa-badge-green", text: "Answered" }));
    if (q.is_mine) badges.push(el("span", { class: "qa-badge", text: q.is_anonymous ? "My question (anonymous)" : "My question" }));

    return el(
      "div",
      {
        class:
          "qa-card qa-question" +
          (q.is_pinned ? " is-pinned" : "") +
          (q.is_answered ? " is-answered" : ""),
      },
      [
        el("div", { class: "qa-question-body" }, [
          el("div", { class: "qa-question-meta" }, [
            el("strong", { class: q.is_anonymous ? "qa-anon" : "", text: q.author }),
            el("span", { class: "qa-muted", text: S.timeAgo(q.created) }),
          ].concat(badges)),
          el("div", { class: "qa-question-content", text: q.content }),
          q.is_mine
            ? el("button", { type: "button", class: "qa-link-btn", text: "Delete", onclick: function () { remove(q); } })
            : null,
        ]),
        el(
          "button",
          {
            type: "button",
            class: "qa-upvote" + (q.upvoted_by_me ? " active" : ""),
            disabled: q.is_mine,
            title: q.is_mine ? "You cannot upvote your own question" : q.upvoted_by_me ? "Remove upvote" : "Upvote",
            "aria-pressed": q.upvoted_by_me ? "true" : "false",
            onclick: function () { upvote(q); },
          },
          [el("span", { class: "qa-upvote-icon", text: "▲" }), el("span", { text: q.upvotes })]
        ),
      ]
    );
  }

  function renderQuestions() {
    var box = document.getElementById("qa-questions");
    var list = state.questions.slice();
    if (sortMode === "recent") {
      list.sort(function (a, b) { return b.id - a.id; });
    }
    document.getElementById("qa-q-total").textContent = S.plural(list.length, "question");
    box.replaceChildren();
    if (!list.length) {
      box.appendChild(el("p", { class: "qa-empty", text: "No questions yet. Be the first to ask!" }));
      return;
    }
    list.forEach(function (q) {
      box.appendChild(questionCard(q));
    });
  }

  // ---------- Polls ----------
  function vote(poll) {
    var selected = drafts[poll.id] || [];
    if (!selected.length) {
      S.toast("Please select an option first", "error");
      return;
    }
    S.api("POST", "/qa/api/polls/" + poll.id + "/vote", { option_ids: selected })
      .then(function () {
        delete drafts[poll.id];
        S.toast("Vote submitted");
        poller.refresh();
      })
      .catch(function (err) {
        S.toast(err.message, "error");
      });
  }

  function pollForm(poll) {
    if (!drafts[poll.id]) drafts[poll.id] = poll.my_votes.slice();
    var selected = drafts[poll.id];
    var voted = poll.my_votes.length > 0;
    var changed =
      selected.slice().sort().join(",") !== poll.my_votes.slice().sort().join(",");

    var options = poll.options.map(function (o) {
      var input = el("input", {
        type: poll.is_multiple ? "checkbox" : "radio",
        name: "qa-poll-" + poll.id,
        value: o.id,
        checked: selected.indexOf(o.id) !== -1,
        onchange: function (e) {
          if (poll.is_multiple) {
            var i = selected.indexOf(o.id);
            if (e.target.checked && i === -1) selected.push(o.id);
            if (!e.target.checked && i !== -1) selected.splice(i, 1);
          } else {
            selected.splice(0, selected.length, o.id);
          }
          renderPolls();
        },
      });
      return el("label", { class: "qa-option" + (input.checked ? " checked" : "") }, [
        input,
        el("span", { text: o.text }),
      ]);
    });

    return el("div", {}, [
      el("div", { class: "qa-options" }, options),
      el("div", { class: "qa-poll-actions" }, [
        el("button", {
          type: "button",
          class: "btn btn-primary",
          disabled: !selected.length || (voted && !changed),
          text: voted ? (changed ? "Update vote" : "Voted") : "Submit vote",
          onclick: function () { vote(poll); },
        }),
        voted ? el("span", { class: "qa-muted", text: "You can change your vote until the poll closes" }) : null,
      ]),
    ]);
  }

  function pollCard(poll) {
    var isOpen = poll.state === "open";
    return el("div", { class: "qa-card qa-poll" }, [
      el("div", { class: "qa-poll-head" }, [
        el("span", {
          class: "qa-badge " + (isOpen ? "qa-badge-green" : ""),
          text: isOpen ? "Live" : "Closed",
        }),
        el("span", { class: "qa-muted", text: poll.is_multiple ? "Multiple choice" : "Single choice" }),
        poll.results_visible ? el("span", { class: "qa-muted", text: S.plural(poll.voters, "participant") }) : null,
      ]),
      el("h3", { class: "qa-poll-title", text: poll.title }),
      isOpen ? pollForm(poll) : null,
      poll.results_visible ? S.pollBars(poll) : null,
      !isOpen && !poll.results_visible ? el("p", { class: "qa-muted", text: "This poll has ended." }) : null,
    ]);
  }

  function renderPolls() {
    var box = document.getElementById("qa-polls");
    var openCount = state.polls.filter(function (p) { return p.state === "open"; }).length;
    var badge = document.getElementById("qa-poll-count");
    badge.hidden = !openCount;
    badge.textContent = openCount;

    box.replaceChildren();
    if (!state.polls.length) {
      box.appendChild(el("p", { class: "qa-empty", text: "No polls right now." }));
      return;
    }
    state.polls.forEach(function (p) {
      box.appendChild(pollCard(p));
    });
  }

  // ---------- Refresh ----------
  function render() {
    var ev = state.event;
    document.getElementById("qa-ask-closed").hidden = ev.qa_open;
    form.hidden = !ev.qa_open;
    renderQuestions();
    renderPolls();
  }

  function refresh() {
    return S.api("GET", "/qa/api/events/" + eventId + "/state")
      .then(function (data) {
        offline.hidden = true;
        var json = JSON.stringify(data);
        // Leave the DOM alone when nothing changed, so we don't interrupt the user
        if (json === lastJson) return;
        var hadOpen = state ? state.polls.filter(function (p) { return p.state === "open"; }).map(function (p) { return p.id; }) : null;
        lastJson = json;
        state = data;
        render();
        if (hadOpen) {
          var newPoll = data.polls.some(function (p) {
            return p.state === "open" && hadOpen.indexOf(p.id) === -1;
          });
          if (newPoll) S.toast("A new poll has started!");
        }
      })
      .catch(function (err) {
        offline.textContent = /404/.test(err.message)
          ? "This session has been closed."
          : "Unable to refresh: " + err.message;
        offline.hidden = false;
        throw err;
      });
  }

  var offline = el("div", { class: "qa-notice qa-notice-error", hidden: true });
  app.insertBefore(offline, app.firstChild);

  // Action handlers call poller.refresh() instead of refresh() so fetches never overlap
  // and an older response can't overwrite a newer one.
  var poller = S.poller(refresh, 4000);
})();
