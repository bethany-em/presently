export const defaultSlides = [
  { title: "", content: "This is slide 1", },
  { title: "", content: "This is slide 2", },
  { title: "", content: "This is slide 3", },
  { title: "", content: "This is slide 4", },
  { title: "", content: "This is slide 5", },
  { title: "", content: "This is slide 6", },
  { title: "", content: "This is slide 7", },
  { title: "", content: "This is slide 8", },
  { title: "", content: "This is slide 9", },
  { title: "", content: "This is slide 10", },
  { title: "", content: "This is slide 11", },
  { title: "", content: "This is slide 12", },
];

export const defaultPresentations = [
  { title: "Presentation 1", slides: structuredClone(defaultSlides), attribution: "Example Attribution © 2024", },
  { title: "Presentation 2", slides: structuredClone(defaultSlides), attribution: "", },
  { title: "Presentation 3", slides: structuredClone(defaultSlides), attribution: "Example Attribution © 2024", },
  { title: "Presentation 4", slides: structuredClone(defaultSlides), attribution: "Example Attribution © 2024", },
  { title: "Presentation 5", slides: structuredClone(defaultSlides), attribution: "Example Attribution © 2024", },
  { title: "Presentation 6", slides: structuredClone(defaultSlides), attribution: "Example Attribution © 2024", },
  { title: "Presentation 7", slides: structuredClone(defaultSlides), attribution: "Example Attribution © 2024", },
  { title: "Presentation 8", slides: structuredClone(defaultSlides), attribution: "Example Attribution © 2024", },
  { title: "Presentation 9", slides: structuredClone(defaultSlides), attribution: "Example Attribution © 2024", },
  { title: "Presentation 10", slides: structuredClone(defaultSlides), attribution: "Example Attribution © 2024", },
  { title: "Presentation 11", slides: structuredClone(defaultSlides), attribution: "Example Attribution © 2024", },
  { title: "Presentation 12", slides: structuredClone(defaultSlides), attribution: "Example Attribution © 2024", },
];

export const defaultDeck = {
  title: "Example Deck",
  presentations: structuredClone(defaultPresentations),
};
