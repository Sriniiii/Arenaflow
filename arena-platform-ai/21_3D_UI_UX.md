# 21 — 3D UI/UX Specification

This document details the requirements, architectural design, performance budget, and UI/UX patterns for the 3D experience in ArenaFlow. 

---

## 1. Web 3D Stack Evaluation & Recommendations

To deliver a premium, performant, and maintainable 3D experience without bloating the codebase, we recommend the following standardized React-Three-Fiber stack:

```mermaid
graph TD
    A[Next.js Application] --> B[React Three Fiber Canvas]
    B --> C[@react-three/drei Helpers]
    B --> D[Three.js Core Renderer]
    B --> E[@react-three/postprocessing]
    C --> F[Optimized GLTF/GLB Assets]
    D --> G[Zustand State Store]
    D --> H[React Spring Animations]
```

### Proposed Stack Components:
1. **Three.js (Core)**: Standard WebGL wrapper.
2. **React Three Fiber (R3F)**: A declarative React renderer for Three.js. It simplifies lifecycle management (canvas sizing, asset preloading, object disposal on unmount) and integrates cleanly with Next.js page transitions.
3. **@react-three/drei**: Provides out-of-the-box helpers like `<OrbitControls>`, `<Html>` overlays, `<Stats>`, loaders, and pre-configured lighting setups. This dramatically reduces boilerplate.
4. **React Spring (`@react-spring/three`)**: Used for physics-based fluid animations. Spring physics feel premium and natural compared to linear interpolations.
5. **@react-three/postprocessing**: Used selectively for depth of field, subtle bloom, and ambient occlusion on high-performance devices.
6. **Zustand**: Used as the global state management. R3F works natively with Zustand, allowing the 3D loop to read reactive state without triggering React re-renders on the main DOM.

---

## 2. Spatial UI/UX Experiences

### A. Landing Page: The Arena Showcase
* **Concept**: A stylized, modern 3D sports stadium/arena centered on a glowing badminton court.
* **Interactivity**: 
  * The camera starts with a cinematic fly-through from the stadium roof down to the court.
  * Users can click-and-drag to orbit around the court (restricting vertical rotation to stay above the floor).
  * Interactive 3D Hotspots (pulsing markers) are placed on key areas of the court:
    * **Hotspot 1 (Net/Court)**: Highlights tournament draw layouts and schedules. Clicking zooms the camera to a flat 2D/3D tournament bracket projection.
    * **Hotspot 2 (Scorer Chair)**: Showcases scorer experience. Clicking zooms into a floating 3D mobile phone mockup showing live score entry.
    * **Hotspot 3 (Spectator Seats)**: Highlights public features. Clicking transitions the camera to a spectator point-of-view, displaying live matches streaming point data.

### B. Tournament Page: The Live Venue Map
* **Concept**: A spatial representation of the physical tournament venue.
* **Interactivity**:
  * Instead of a text-only list, active tournaments can render a 3D grid of courts (e.g. Court 1, Court 2, Court 3).
  * Each court is represented as a low-poly 3D mesh with active statuses:
    * **Pulsing Green glow**: Active match, live-scoring.
    * **Pulsing Orange/Red glow**: Match point or high-tension rally sequence.
    * **Grey/Dark**: Empty or warm-up phase.
  * Clicking a court flies the camera directly over it and reveals an overlay with current player names, scores, and match statistics.

### C. Dashboard: Spatial Stat Cards & Trophies
* **Concept**: Micro-interactions for organizers and players that feel tangible.
* **Visuals**:
  * **3D Glassmorphic Cards**: Statistics summaries (e.g., Win Rate, Total Matches) react to mouse movement with tilt effects, altering light reflections on their virtual glass surface (achieved using shallow R3F canvas cards or CSS 3D transforms).
  * **Interactive Trophies/Badges**: Achieved tournament milestones render in 3D. Players can rotate their medals/trophies, which dynamically catch reflections from a custom environment map.

### D. Court & Match Visualization: Analytical Live Track
* **Concept**: A tactical representation of a badminton match in play.
* **Visuals**:
  * **Heatmaps**: A 3D court showing color-graded spots where shuttlecocks land during a match, assisting players in tactical review.
  * **Rally Tracers**: Visual arcs representing shot trajectories (lobs, smashes, drops) mapped onto the 3D space during recorded points.
  * **Live Placement Tracker**: Displays where points were won/lost (e.g., errors at the net vs. winners on the backline).

---

## 3. Motion, Transitions & Animations

* **Physics-based Springs**: All camera movements, scale-ups on hover, and light adjustments must use `@react-spring` to prevent robotic, linear transitions.
* **Dynamic Camera Paths**: Smooth camera spline interpolation between pre-defined coordinates based on active UI sections.
* **Hover State Reactivity**: Mesh assets must subtly scale, shift height, or rotate toward the cursor position, drawing visual focus.

---

## 4. Performance Budget & Asset Optimization

3D elements must remain secondary to performance. We establish the following strict constraints:

| Metric | Target | Maximum / Limit |
| :--- | :--- | :--- |
| **Total 3D Asset Size** | < 1.5 MB (compressed) | 3.0 MB |
| **Draw Calls** | < 30 per scene | 50 |
| **Polygon Count (Tris)** | < 15,000 per scene | 30,000 |
| **Texture Sizes** | 512x512 or 1024x1024 (compressed) | 2048x2048 |
| **Target Frame Rate** | 60 FPS | 30 FPS (Minimum on mobile) |

### Optimization Techniques:
1. **Mesh Compression**: All models must be exported as `.gltf`/`.glb` and run through **Draco compression** (`gltf-pipeline` or `glTF-Transform`).
2. **Texture Formats**: Use KTX2/Basis Universal or high-compression WebP textures instead of raw PNG/JPG.
3. **Instanced Meshes**: For repetitive assets (stadium chairs, court posts, banners), use Three.js instancing (`<instancedMesh>`) to combine draw calls.
4. **Dynamic Level of Detail (LOD)**: Load simpler geometry for objects far from the camera.
5. **Asset Disposal**: Always unmount and dispose of geometries, materials, and textures when R3F canvases unmount to avoid JS memory leaks.

---

## 5. Responsive Behavior

* **Dynamic FOV**: Adjust the camera's Field of View (FOV) dynamically based on the aspect ratio. Mobile screens (portrait) require a wider FOV and camera zoom backout to keep the central 3D scene within the viewport.
* **Layout Adaptation**: On desktop, the 3D canvas and controls occupy a side-by-side split layout with text/data. On mobile, the 3D canvas shrinks to a header position, or moves behind the text as a non-interactive background.
* **Touch Optimization**: Replace mouse hover interactions with distinct tap gestures for mobile devices. Set high dampening on `<OrbitControls>` to prevent erratic camera spins during mobile touch-scrolling.

---

## 6. Accessibility & Fallback States

3D is an enhancer, never a blocker.

### A. Reduced Motion Compliance
* We listen to the CSS media query `(prefers-reduced-motion: reduce)`.
* If enabled:
  * Camera fly-throughs are completely bypassed.
  * Camera snaps instantly between viewpoints.
  * Orbital rotations and animations are paused.

### B. High-Performance / Low-End Fallbacks
* A performance monitor will track the frame rate.
* **Step-Down Degradation**:
  1. If FPS drops below 45 for more than 4 seconds: Turn off post-processing and disable shadow mapping.
  2. If FPS remains below 30: Switch to static, unlit materials (MeshBasicMaterial) and disable reflections.
  3. If WebGL is unsupported or extremely slow: Swap the R3F canvas out completely for a static SVG diagram or pre-rendered WebP image.

### C. Screen Readers & Semantics
* A hidden 2D HTML alternative must mirror all interactive elements of the 3D canvas.
* Tab key navigation will cycle focus through the interactive hotspots, focusing an invisible HTML button adjacent to the canvas that describes the hotspot and updates the page state on Enter.
* Use `aria-hidden="true"` on the physical `<canvas>` element so screen readers ignore raw WebGL canvas layers.
