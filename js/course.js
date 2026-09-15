
document.addEventListener("DOMContentLoaded", () => {
  const sections = document.querySelectorAll("main section, main article");
  const navLinks = document.querySelectorAll("nav a");

  const observer = new IntersectionObserver(
    entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          // Remove active from all links
          navLinks.forEach(link => link.classList.remove("active"));
          // Highlight the link pointing to this section/article
          const id = entry.target.getAttribute("id");
          const activeLink = document.querySelector(`nav a[href="#${id}"]`);
          if (activeLink) activeLink.classList.add("active");
        }
      });
    },
    { rootMargin: "0px 0px -70% 0px", threshold: 0 }
  );

  sections.forEach(section => observer.observe(section));
});
