/* Admin: session list page + single session management page */
(function () {
  "use strict";

  var S = window.CTFdQA;
  var el = S.el;

  function fail(err) {
    S.toast(err.message, "error");
  }

  // ======================= Session list =======================
  var newEventForm = document.getElementById("qa-new-event");
  if (newEventForm) {
    newEventForm.addEventListener("submit", function (e) {
      e.preventDefault();
      S.api("POST", "/admin/qa/api/events", {
        title: document.getElementById("qa-event-title").value,
        description: document.getElementById("qa-event-description").value,
      })
        .then(function (event) {
          window.location = S.url("/admin/qa/" + event.id);
        })
        .catch(fail);
    });

    document.querySelectorAll("tr[data-event-id]").forEach(function (row) {
      var id = row.dataset.eventId;
      row.querySelectorAll(".qa-toggle").forEach(function (box) {
        box.addEventListener("change", function () {
          var body = {};
          body[box.dataset.field] = box.checked;
          S.api("PATCH", "/admin/qa/api/events/" + id, body).catch(function (err) {
            box.checked = !box.checked;
            fail(err);
          });
        });
      });
      row.querySelector(".qa-delete-event").addEventListener("click", function () {
        if (!confirm("Delete this session? All of its questions and polls will be permanently deleted.")) return;
        S.api("DELETE", "/admin/qa/api/events/" + id)
          .then(function () {
            row.remove();
          })
          .catch(fail);
      });
    });
  }

  // ======================= Single session =======================
  var root = document.getElementById("qa-admin-event");
  if (!root) return;

  var eventId = root.dataset.eventId;
  var state = null;
  var lastJson = "";
  var filter = "pending";
  var PRESENT_KEY = "qa-present-" + eventId;

  function refresh() {
    return S.api("GET", "/admin/qa/api/events/" + eventId + "/state").then(function (data) {
      var json = JSON.stringify(data);
      if (json === lastJson) return;
      lastJson = json;
      state = data;
      renderQuestions();
      renderPolls();
    });
  }
  var poller = S.poller(refresh, 3000);

  function act(method, path, body) {
    return S.api(method, path, body).then(poller.refresh).catch(fail);
  }

  // ---------- Session settings ----------
  root.querySelectorAll(".qa-event-toggle").forEach(function (box) {
    box.addEventListener("change", function () {
      var body = {};
      body[box.dataset.field] = box.checked;
      S.api("PATCH", "/admin/qa/api/events/" + eventId, body)
        .then(function () {
          S.toast("Updated");
        })
        .catch(function (err) {
          box.checked = !box.checked;
          fail(err);
        });
    });
  });

  // ---------- Questions ----------
  var filters = {
    pending: function (q) { return !q.is_hidden && !q.is_answered; },
    answered: function (q) { return !q.is_hidden && q.is_answered; },
    hidden: function (q) { return q.is_hidden; },
    all: function () { return true; },
  };

  document.querySelectorAll("#qa-q-filter .qa-sort-btn").forEach(function (b) {
    b.addEventListener("click", function () {
      filter = b.dataset.filter;
      document.querySelectorAll("#qa-q-filter .qa-sort-btn").forEach(function (x) {
        x.classList.toggle("active", x === b);
      });
      renderQuestions();
    });
  });

  function qButton(label, cls, onclick) {
    return el("button", { type: "button", class: "btn btn-sm " + cls, text: label, onclick: onclick });
  }

  function patchQuestion(q, body) {
    return act("PATCH", "/admin/qa/api/questions/" + q.id, body);
  }

  function adminQuestionCard(q) {
    var badges = [];
    if (q.is_anonymous) badges.push(el("span", { class: "qa-badge", text: "Anonymous" }));
    if (q.is_pinned) badges.push(el("span", { class: "qa-badge qa-badge-blue", text: "Pinned" }));
    if (q.is_answered) badges.push(el("span", { class: "qa-badge qa-badge-green", text: "Answered" }));
    if (q.is_hidden) badges.push(el("span", { class: "qa-badge qa-badge-red", text: "Hidden" }));

    return el(
      "div",
      {
        class:
          "qa-card qa-question" +
          (q.is_pinned ? " is-pinned" : "") +
          (q.is_answered || q.is_hidden ? " is-answered" : ""),
      },
      [
        el("div", { class: "qa-question-body" }, [
          el("div", { class: "qa-question-meta" }, [
            el("a", { href: S.url("/admin/users/" + q.user_id), target: "_blank", rel: "noopener" }, [
              el("strong", { text: q.user_name }),
            ]),
            el("span", { class: "qa-muted", text: S.timeAgo(q.created) }),
          ].concat(badges)),
          el("div", { class: "qa-question-content", text: q.content }),
          el("div", { class: "qa-question-actions" }, [
            qButton(q.is_answered ? "Mark unanswered" : "Mark answered", q.is_answered ? "btn-outline-secondary" : "btn-success", function () {
              patchQuestion(q, { is_answered: !q.is_answered });
            }),
            qButton(q.is_pinned ? "Unpin" : "Pinned", "btn-outline-primary", function () {
              patchQuestion(q, { is_pinned: !q.is_pinned });
            }),
            qButton(q.is_hidden ? "Unhide" : "Hide", "btn-outline-secondary", function () {
              patchQuestion(q, { is_hidden: !q.is_hidden });
            }),
            qButton("Delete", "btn-outline-danger", function () {
              if (confirm("Delete this question?")) act("DELETE", "/admin/qa/api/questions/" + q.id);
            }),
          ]),
        ]),
        el("div", { class: "qa-upvote qa-upvote-static", title: "Upvotes" }, [
          el("span", { class: "qa-upvote-icon", text: "▲" }),
          el("span", { text: q.upvotes }),
        ]),
      ]
    );
  }

  function renderQuestions() {
    document.querySelectorAll("#qa-q-filter .qa-sort-btn").forEach(function (b) {
      b.querySelector("span").textContent = "(" + state.questions.filter(filters[b.dataset.filter]).length + ")";
    });
    var box = document.getElementById("qa-admin-questions");
    var list = state.questions.filter(filters[filter]);
    box.replaceChildren();
    if (!list.length) {
      box.appendChild(el("p", { class: "qa-empty", text: "No questions." }));
      return;
    }
    list.forEach(function (q) {
      box.appendChild(adminQuestionCard(q));
    });
  }

  // ---------- Create poll ----------
  var optionBox = document.getElementById("qa-poll-options");

  function addOptionInput(value) {
    var row = el("div", { class: "qa-poll-option-row" }, [
      el("input", { type: "text", class: "form-control", maxlength: 256, placeholder: "Option", value: value || "" }),
      el("button", {
        type: "button",
        class: "btn btn-sm btn-outline-secondary",
        text: "✕",
        title: "Remove option",
        onclick: function () {
          if (optionBox.children.length > 2) row.remove();
        },
      }),
    ]);
    optionBox.appendChild(row);
    return row;
  }

  function resetPollForm() {
    document.getElementById("qa-poll-title").value = "";
    optionBox.replaceChildren();
    addOptionInput();
    addOptionInput();
  }
  resetPollForm();

  document.getElementById("qa-add-option").addEventListener("click", function () {
    addOptionInput().querySelector("input").focus();
  });

  document.getElementById("qa-new-poll").addEventListener("submit", function (e) {
    e.preventDefault();
    var options = [].map
      .call(optionBox.querySelectorAll("input"), function (i) { return i.value.trim(); })
      .filter(Boolean);
    S.api("POST", "/admin/qa/api/events/" + eventId + "/polls", {
      title: document.getElementById("qa-poll-title").value,
      options: options,
      is_multiple: document.getElementById("qa-poll-multiple").checked,
      state: document.getElementById("qa-poll-open").checked ? "open" : "draft",
      show_results: document.getElementById("qa-poll-show").checked,
    })
      .then(function () {
        resetPollForm();
        S.toast("Poll created");
        return poller.refresh();
      })
      .catch(fail);
  });

  // ---------- Poll list ----------
  var STATE_LABEL = { draft: "Draft", open: "Live", closed: "Closed" };

  function presentPoll(poll) {
    try {
      localStorage.setItem(PRESENT_KEY, JSON.stringify({ mode: "poll", pollId: poll.id, t: Date.now() }));
      S.toast("Presentation switched to this poll");
    } catch (e) {
      fail(new Error("localStorage is unavailable; switch polls from the presentation window instead"));
    }
  }

  function adminPollCard(poll) {
    var patch = function (body) {
      return act("PATCH", "/admin/qa/api/polls/" + poll.id, body);
    };
    var buttons = [];
    if (poll.state === "open") {
      buttons.push(qButton("Close poll", "btn-warning", function () { patch({ state: "closed" }); }));
    } else {
      buttons.push(qButton(poll.state === "draft" ? "Start poll" : "Reopen", "btn-success", function () { patch({ state: "open" }); }));
    }
    buttons.push(
      qButton(poll.show_results ? "Hide results from students" : "Show results to students", "btn-outline-primary", function () {
        patch({ show_results: !poll.show_results });
      }),
      qButton("Present", "btn-outline-secondary", function () { presentPoll(poll); }),
      qButton("Reset votes", "btn-outline-secondary", function () {
        if (confirm("Reset all votes for this poll?")) act("POST", "/admin/qa/api/polls/" + poll.id + "/reset");
      }),
      qButton("Delete", "btn-outline-danger", function () {
        if (confirm("Delete this poll?")) act("DELETE", "/admin/qa/api/polls/" + poll.id);
      })
    );

    return el("div", { class: "qa-card qa-poll" }, [
      el("div", { class: "qa-poll-head" }, [
        el("span", {
          class: "qa-badge" + (poll.state === "open" ? " qa-badge-green" : ""),
          text: STATE_LABEL[poll.state],
        }),
        el("span", { class: "qa-muted", text: poll.is_multiple ? "Multiple choice" : "Single choice" }),
        el("span", { class: "qa-muted", text: S.plural(poll.voters, "participant") }),
        poll.show_results ? el("span", { class: "qa-badge qa-badge-blue", text: "Results visible to students" }) : null,
      ]),
      el("h5", { class: "qa-poll-title", text: poll.title }),
      S.pollBars(poll, { hideMine: true }),
      el("div", { class: "qa-question-actions" }, buttons),
    ]);
  }

  function renderPolls() {
    var box = document.getElementById("qa-admin-polls");
    box.replaceChildren();
    state.polls.forEach(function (p) {
      box.appendChild(adminPollCard(p));
    });
  }
})();
