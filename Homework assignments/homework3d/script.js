const filterButtons = document.querySelectorAll(".filter-button");
const pathCards = document.querySelectorAll(".path-card");
const trackTabs = document.querySelectorAll(".track-tab");
const trackLinks = document.querySelectorAll("[data-track-target]");
const trackPanels = document.querySelectorAll(".track-panel");

function setActiveTrack(trackId) {
  for (const tab of trackTabs) {
    const isMatch = tab.dataset.trackTarget === trackId;
    tab.classList.toggle("is-active", isMatch);
    tab.setAttribute("aria-selected", String(isMatch));
  }

  for (const panel of trackPanels) {
    const isMatch = panel.dataset.trackPanel === trackId;
    panel.classList.toggle("is-active", isMatch);
    panel.hidden = !isMatch;
  }
}

for (const button of filterButtons) {
  button.addEventListener("click", () => {
    const selectedLevel = button.dataset.filter;

    for (const candidate of filterButtons) {
      candidate.classList.toggle("is-active", candidate === button);
    }

    for (const card of pathCards) {
      const matches =
        selectedLevel === "all" || card.dataset.level === selectedLevel;

      card.classList.toggle("is-hidden", !matches);
      card.hidden = !matches;
      card.setAttribute("aria-hidden", String(!matches));
    }
  });
}

for (const control of trackLinks) {
  control.addEventListener("click", () => {
    setActiveTrack(control.dataset.trackTarget);
    document.querySelector(".track-explorer")?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  });
}

const quiz = document.querySelector("#readiness-quiz");
const quizResult = document.querySelector("#quiz-result");

const recommendations = [
  {
    maxScore: 2,
    title: "Start with Cookies & Bars",
    copy:
      "Focus on ingredient setup, oven timing, and how sugar and fat affect spread. This track teaches quick feedback with low risk.",
  },
  {
    maxScore: 4,
    title: "Move into Cakes & Frosting",
    copy:
      "You have the basics. Next, tighten batter consistency and pan management so your bakes rise evenly and stay tender.",
  },
  {
    maxScore: 6,
    title: "You are ready for Bread Basics",
    copy:
      "Your habits support more precision. Start learning dough development, proofing cues, and how to adjust for texture instead of adding flour blindly.",
  },
];

quiz.addEventListener("submit", (event) => {
  event.preventDefault();

  const formData = new FormData(quiz);
  const score = [...formData.values()].reduce(
    (total, value) => total + Number(value),
    0,
  );

  const match =
    recommendations.find((recommendation) => score <= recommendation.maxScore) ??
    recommendations[recommendations.length - 1];

  quizResult.innerHTML = `<strong>${match.title}</strong><p>${match.copy}</p>`;
});
