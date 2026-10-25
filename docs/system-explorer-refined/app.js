(() => {
  const dialog = document.querySelector(".image-dialog"),
    image = dialog.querySelector("img");
  document
    .querySelector("[data-print]")
    .addEventListener("click", () => window.print());
  document.querySelectorAll("[data-image-open]").forEach((button) =>
    button.addEventListener("click", () => {
      const source = button.querySelector("img");
      image.src = source.src;
      image.alt = source.alt;
      document.querySelector("#image-title").textContent = source.alt;
      dialog.showModal();
      dialog.querySelector(".image-scroll").scrollTo(0, 0);
    }),
  );
  document
    .querySelector("[data-image-close]")
    .addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  const links = [...document.querySelectorAll("nav a")];
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries)
        if (entry.isIntersecting) {
          links.forEach((a) =>
            a.classList.toggle("active", a.hash === "#" + entry.target.id),
          );
        }
    },
    { rootMargin: "-5% 0px -75% 0px" },
  );
  document
    .querySelectorAll("article section")
    .forEach((section) => observer.observe(section));
  if (innerWidth <= 760) document.querySelector(".toc").open = false;
})();
