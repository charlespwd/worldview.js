import vector from './utils/vector'
import matrix, { R } from './utils/matrix'
import { setState } from './utils/functional'
import * as math from './utils/math'

// Transformations are simple WorldState -> WorldState mappings.
// The simplest world transformation: change a value.
export const set = (key, value) => (state) => setState(state, key, value)
export const identity = (state) => state

// Give me a set of transformations and a state and I'll give you a
// new state. Transformations are composable.
export const reduce = (transforms = [], initialState) => (
  [].concat(transforms).reduce((state, transform) => transform(state), initialState)
)

// # Fixed point zoom transformation
// For {}_i and {}_f denotes initial and final transformation, we have
//
// 1. A constant rotation,
//   R = R_i = R_f  .. (1)
// 2. A constant pointer position relative to the container,
//   p_c = p_c_i = p_c_f  .. (2)
// 3. A constant pointer position relative to the world,
//   p_w = p_w_i = p_w_f .. (3)
// 4. A transformation world->container defined by
//   x_w = 1/z*R^-1*(x_c - t_c) .. (4)
//
// For z is the scale level, and t the translation vector.
//
// From (1), (2), (3) and (4) together we get
//   p_c = 1/z_i*R^-1*(p_c - t_c_i)  .. (5)
//   p_c = 1/z_f*R^-1*(p_c - t_c_f)  .. (6)
//
// From (5), and (6) we get
//   z_f*R^-1*(p_c - t_c_i) = z_i*R^-1*(p_c - t_c_f)
//
// Multiply both sides by R
//   z_f*(p_c - t_c_i) = z_i*(p_c - t_c_f)
//
// And finally
//   t_c_f = p_c + z_f / z_i * (t_c_i - p_c)
export const statelessZoom = (zoom_f, pointer_container) => (state) => {
  const zoom_i = state.scale
  const world_container_i = state.world_container
  const world_container_f = vector.add(
    pointer_container,
    vector.scale(
      zoom_f / zoom_i,
      vector.sub(
        world_container_i,
        pointer_container
      )
    )
  )

  return {
    ...state,
    world_container: world_container_f,
    scale: zoom_f,
  }
}

// # Fixed point pan transformation
// For {}_i and {}_f denotes initial and final transformation, we have
//
// 1. A constant rotation,
//   R = R_i = R_f  .. (1)
// 2. A constant zoom,
//   z = z_i = z_f  .. (2)
// 3. A constant pointer position relative to the world,
//   p_w = p_w_i = p_w_f  .. (3)
// 4. A translation vector defined in the container coordinate system,
//   ∆p_c = p_c_f - p_c_i  .. (4)
// 5. A transformation container->world defined by
//   x_w = 1/z*R^-1*(x_c - t_c) .. (4)
//
// For z is the scale level, and t the translation vector.
//
// From (1), (2), (3), and (5) together we get
//   p_c_i = z*R*p_w + t_c_i  .. (6)
//   p_c_f = z*R*p_w + t_c_f  .. (7)
//
// Subtract (6) from (7)
//   p_c_f - p_c_i = t_c_f - t_c_i .. (8)
//
// Finally, from (8) and (2)
//   t_c_f = ∆p_c + t_c_i
export const statelessPanBy = (translation_container) => (state) => {
  const world_container_i = state.world_container
  const world_container_f = vector.add(
    translation_container,
    world_container_i
  )

  return {
    ...state,
    world_container: world_container_f,
  }
}

/// Fixed point rotation transformation
// For {}_i and {}_f denotes initial and final transformation, we have
//
// 1. A constant zoom,
//   z = z_i = z_f  .. (1)
// 2. A constant pointer position relative to the container,
//   p_c = p_c_i = p_c_f  .. (2)
// 3. A constant pointer position relative to the world,
//   p_w = p_w_i = p_w_f  .. (3)
// 4. A rotation matrix defined by an angle theta
//      R = R(theta)  .. (4.1)
//   R^-1 = R(-theta) .. (4.2)
// 5. A transformation container->world defined by
//   x_w = 1/z*(R^-1)(x_c - t_c)
//
// For z is the zoom level, and t the translation vector.
//
// From (1), (2), (3), (4) and (5) together we get
//   p_c = 1/z*R(-theta_i)*(p_c - t_c_i)  .. (6)
//   p_c = 1/z*R(-theta_f)*(p_c - t_c_f)  .. (7)
//
// Finally, from (6) and (7), we obtain
//   t_c_f = p_c - R(theta_f) * R(-theta_i) * (p_c - t_c_i)
export const statelessRotateBy = (degrees, pivot_container = [0, 0]) => (state) => {
  const theta_i = state.theta
  const theta_f = state.theta + degrees
  const world_container_i = state.world_container
  const world_container_f = vector.sub(
    pivot_container,
    matrix.product(
      matrix.product(R(theta_f), R(-theta_i)),
      vector.sub(pivot_container, world_container_i)
    )
  )

  return {
    ...state,
    theta: theta_f,
    world_container: world_container_f,
  }
}

export const fit = (options = {}) => (state) => {
  if (options.fitNoWhitespace) {
    return fitNoWhitespace(state, options)
  }

  return fitWithWhitespace(state, options)
}

// # Fitting without whitespace
// We have two limits, the first one is on the scale, the second one is on the
// translation vector.
//
// The Goal: Any points visible within the container are points within the
// world.
//
// ## Part 1, the scale limit
//
// We have
// 1. The size of the world
//      W_w = wlimit_w - 0_w   .. (1)
// 2. The size of the container
//      C_c = climit_c - 0_c  .. (2)
// 3. The coordinate transformation
//      x_c = z*x_w + t_c  .. (3)
// 4. From (3) and (1)
//      W_c = z*W_w
//
// for z is the scale, t_c the translation vector, wlimit the vector pointing to
// the limiting corner, climit the vector pointing to the corner limit of the
// container, and 0_x the zero vector.
//
// When fitting at the limit, one of the world size component is equal to the
// container size.
//
// Thus we have
//      C_c_x = W_c_x = k_limit*W_w_X  ... or ... C_c_y = W_c_y = k*W_w_y
//
// Therefore
//      k_limit <= k
//      k_limit = max(C_c_x / W_w_x, C_c_y / W_w_y) <= k
//
// ## Part 2, the translation limit
//
// We have
// 1. A container domain `C` defined as
//   C = { x_c : 0_c <= x_c <= C_c }  .. (1)
// 2. The world domain `W` defined as
//   W = { x_w : 0_w <= x_w <= W_w } .. (2)
// 3. The coordinate transformations
//   x_c = z*x_w + t_c  .. (3)
//   x_w = 1/z*(x_c - t_c)  .. (4)
//
// Since all points in the container must be contained by the world, we have
//   C ⊆ W  ... (5)
//
// In an effort to obtain limits on t_c, we transform W into the container's
// coordinate system.
//   0_w = 1/z * (x_c_l - t_c) which implies x_c_l = t_c
//   W_w = 1/z * (x_c_r - t_c) which implies x_c_r = z*W_w + t_c
//   W = { x_c: x_c_l <= x_c <= x_c_r }
//   W = { x_c: t_c <= x_c <= z*W_w + t_c }
//
// Since C ⊆ W, we get
//   t_c <= 0 <= x_c <= C_c <= z*W_w + t_c
//
// Limit #1
//   t_c <= 0
//
// Limit #2
//   C_c - z*W_w <=  t_c
//
// Therefore, C_c - z*W_w <= t_c <= 0
function fitNoWhitespace(state, options) {
  const { worldSize, containerSize } = state
  const limit = scaleLimit(state, options)
  const scale = math.bounded(
    options.minZoom,
    Math.max(limit, state.scale),
    options.maxZoom
  )
  return ({
    ...state,
    scale,
    world_container: vector.bounded(
      vector.sub(
        containerSize,
        vector.scale(scale, worldSize)
      ),
      state.world_container,
      vector.zero
    ),
  })
}

// # Fitting with whitespace
//
// Fitting with whitespace is similar to fitting without whitespace. In fact,
// it's the very same strategy we're using EXCEPT that we enlarge the world (W) with
// whitespace such that the transformed world (T) has the same aspect ratio as
// the Container(C).
//
// We enlarge the world with whitespace such that
//   1) it is centered within the container
//   2) it is only enlarged in one direction
//
// Here's an illustration
//
//   ------
//  |      |
//  | 16x6 | World
//  |      |
//   ------W
//
//   ----------
//  |          |
//  |   13x3   | Container
//  |          |
//   ----------C
//
//   ----------
//  |w|      |w|
//  |w| 26x6 |w| Transformed World
//  |w|      |w|
//   --------W-T
//
// Thus we have the three domains
//  1) C = { x_c | 0 <= x_c <= C_c }
//  2) W = { x_w | 0 <= x_w <= W_w }
//  3) T = { x_t | 0 <= x_t <= T_t }
//
// And following transformations from one coordinate system to the other
//
//  4) x_t = x_w + dx_w
//  5) x_c = k * x_w + t_c
//
// Where C_c is the container size in the container coords
// Where W_w is the world size in the world coords
// Where T_t is the transformed world size in transformed world coords
// Where {}_c, {}_w, {}_t define vectors in the container, world, and
//  transformed world coordinate systems
// Where dx_{} is the width of the whitespace
// Where t_{} is the distance between the world and container origins
//
// If we say that the world is centered within the container, it means that
//
//  6) 2 * dx_w + W_w = C_w
//
// Solving for dx_w, since C_w = C_c / klimit we get
//  7) dx_w = 0.5 * (C_w - W_w)
//     dx_w = 0.5 * (C_c / klimit - W_w)
//
// Transforming 3) into container and world coords we get
//  8) T = { x_c | x_left_c <= x_c <= x_right_c }
//       = { x_w | x_left_w <= x_c <= x_right_w }
//
// From 4) and 8), we get
//  9) x_left_w  = 0   - dx_w   AND
//     x_right_w = T_t - dx_w = W_w + dx_w
//
// From 5) and 9), we get
//  10) x_left_c  = k * (-dx_w)      + t_c  AND
//      x_rigth_c = k * (W_w + dx_w) + t_c
//
// Since all points in the container must be contained by the transformed world, we have
//  11) C ⊆ T
//
// Thus,
//  12) x_left_c <= 0 <= x_c <= C_c <= x_right_c
//
// Which implies, from 10)
//  13) -k * dx_w + t_c <= 0  AND
//                  C_c <= k * (W_w + dx_w) + t_c
//
// Finally, solving for t_c, we get our translation limits
//  14) t_c <= k * dx_w  AND
//      t_c >= C_c - k * (W_w + dx_w)
function fitWithWhitespace(state, options) {
  const { worldSize, containerSize } = state
  const limit = scaleLimit(state, options, Math.min)

  // dx_w = 0.5 * (C_c / klimit - W_w)
  const dx_w = vector.scale(
    0.5,
    vector.sub(
      vector.scale(1 / limit, containerSize),
      worldSize
    )
  );

  const scale = math.bounded(
    options.minZoom,
    Math.max(limit, state.scale),
    options.maxZoom
  )

  // C_c - k * (W_w + dx_w) <= t_c <= k * dx_w
  const t_c = vector.bounded(
    // C_c - k * (W_w + dx_w)
    vector.sub(
      containerSize,
      vector.scale(
        scale,
        vector.add(worldSize, dx_w)
      )
    ),
    // t_c
    state.world_container,
    // k * dx_w
    vector.scale(scale, dx_w)
  )

  return ({
    ...state,
    scale,
    world_container: t_c,
  })
}

export function scaleLimit(
  { worldSize, containerSize },
  { fitMarginX = 0, fitMarginY = 0 } = {},
  comparator = Math.max
) {
  const scalelimit_x = (containerSize[0] - 2 * fitMarginX) / worldSize[0]
  const scalelimit_y = (containerSize[1] - 2 * fitMarginY) / worldSize[1]
  return comparator(scalelimit_x, scalelimit_y)
}
