-- Sample lesson: WASSCE Core Mathematics — Trigonometric Ratios
INSERT OR IGNORE INTO ec_lessons (id, teacher_id, subject, level, topic, content_json, estimated_minutes, xp_reward)
VALUES (
  'shs-math-trig-01',
  'abena',
  'core_mathematics',
  'shs',
  'Trigonometric Ratios',
  '[
    {
      "step": 1,
      "voice_script": "Good morning class! Today we are going to learn about trigonometric ratios. Let me draw a right-angled triangle on the board.",
      "board_actions": [
        { "action": "drawShape", "type": "triangle", "points": [[60,220],[220,220],[220,100]], "delay_ms": 2000 }
      ],
      "checkpoint": null
    },
    {
      "step": 2,
      "voice_script": "This longest side, opposite the right angle, is called the hypotenuse. In Ghana, you might think of it like the longest path from your house to school.",
      "board_actions": [
        { "action": "addLabel", "text": "Hypotenuse", "position": [140, 150], "color": "#EF9F27", "delay_ms": 1500 }
      ],
      "checkpoint": null
    },
    {
      "step": 3,
      "voice_script": "The side next to the angle we are looking at is called the adjacent side. And the side across from that angle is the opposite side.",
      "board_actions": [
        { "action": "addLabel", "text": "Adjacent", "position": [140, 230], "color": "#4FC3F7", "delay_ms": 1000 },
        { "action": "addLabel", "text": "Opposite", "position": [230, 160], "color": "#81C784", "delay_ms": 1000 }
      ],
      "checkpoint": null
    },
    {
      "step": 4,
      "voice_script": "Now here is the key formula. SOH CAH TOA! Sine equals Opposite over Hypotenuse. Cosine equals Adjacent over Hypotenuse. Tangent equals Opposite over Adjacent.",
      "board_actions": [
        { "action": "addLabel", "text": "SOH: sin = O/H", "position": [20, 30], "color": "#FCD116", "delay_ms": 1500 },
        { "action": "addLabel", "text": "CAH: cos = A/H", "position": [20, 55], "color": "#FCD116", "delay_ms": 1500 },
        { "action": "addLabel", "text": "TOA: tan = O/A", "position": [20, 80], "color": "#FCD116", "delay_ms": 1500 }
      ],
      "checkpoint": null
    },
    {
      "step": 5,
      "voice_script": "Now it is your turn. What is cosine of angle A? Remember CAH — Cosine equals Adjacent over Hypotenuse. Type your answer below.",
      "board_actions": [],
      "checkpoint": {
        "type": "text_input",
        "question": "What is cos(A)?",
        "correct_answer": "Adjacent/Hypotenuse",
        "accept_variations": ["adj/hyp", "adjacent over hypotenuse", "Adj/Hyp", "A/H"],
        "hint": "Remember CAH — Cosine equals Adjacent over Hypotenuse",
        "xp_reward": 50
      }
    }
  ]',
  15,
  100
);
