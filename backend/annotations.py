"""Keep one label per physical damage region and draw readable annotations."""

from __future__ import annotations

from PIL import Image, ImageDraw, ImageFont


COLORS = ("#1463a5", "#b45309", "#a21caf", "#15803d", "#be123c", "#0e7490")


def box_iou(first: list[float], second: list[float]) -> float:
    x1 = max(first[0], second[0])
    y1 = max(first[1], second[1])
    x2 = min(first[2], second[2])
    y2 = min(first[3], second[3])
    intersection = max(0.0, x2 - x1) * max(0.0, y2 - y1)
    first_area = max(0.0, first[2] - first[0]) * max(0.0, first[3] - first[1])
    second_area = max(0.0, second[2] - second[0]) * max(0.0, second[3] - second[1])
    union = first_area + second_area - intersection
    return intersection / union if union > 0 else 0.0


def suppress_duplicate_boxes(detections: list[dict], threshold: float = 0.85) -> list[dict]:
    """Class-agnostic suppression for boxes covering nearly the same pixels."""
    selected: list[dict] = []
    for detection in sorted(detections, key=lambda item: item["confidence"], reverse=True):
        if all(box_iou(detection["bbox"], kept["bbox"]) < threshold for kept in selected):
            selected.append(detection)
    return selected


def render_annotations(image: Image.Image, detections: list[dict]) -> Image.Image:
    """Draw numbered boxes on the image and class names in a separate legend."""
    source = image.convert("RGB")
    width, height = source.size
    font_size = max(14, min(24, width // 55))
    try:
        font = ImageFont.truetype("DejaVuSans.ttf", font_size)
    except OSError:
        try:
            font = ImageFont.load_default(size=font_size)
        except TypeError:
            font = ImageFont.load_default()
    line_height = font_size + 14
    legend_count = min(len(detections), 12)
    legend_height = line_height * legend_count + (18 if detections else 0)
    if len(detections) > legend_count:
        legend_height += line_height
    canvas = Image.new("RGB", (width, height + legend_height), "white")
    canvas.paste(source, (0, 0))
    draw = ImageDraw.Draw(canvas)
    stroke = max(2, min(6, width // 300))
    for index, detection in enumerate(detections):
        color = COLORS[index % len(COLORS)]
        x1, y1, x2, y2 = detection["bbox"]
        x1 = max(0, min(width - 1, int(round(x1))))
        x2 = max(0, min(width - 1, int(round(x2))))
        y1 = max(0, min(height - 1, int(round(y1))))
        y2 = max(0, min(height - 1, int(round(y2))))
        if x2 <= x1 or y2 <= y1:
            continue
        draw.rectangle((x1, y1, x2, y2), outline=color, width=stroke)
        marker = str(index + 1)
        bounds = draw.textbbox((0, 0), marker, font=font)
        marker_width = bounds[2] - bounds[0] + 14
        marker_height = bounds[3] - bounds[1] + 10
        marker_y = y1 if y1 + marker_height <= height else max(0, y1 - marker_height)
        draw.rectangle((x1, marker_y, min(width, x1 + marker_width), marker_y + marker_height), fill=color)
        draw.text((x1 + 7, marker_y + 4 - bounds[1]), marker, fill="white", font=font)
        if index < legend_count:
            legend_y = height + 9 + index * line_height
            draw.rectangle((12, legend_y + 3, 12 + font_size, legend_y + 3 + font_size), fill=color)
            label = f"{marker}. {detection['class_name'].replace('_', ' ')}  {detection['confidence'] * 100:.1f}%"
            draw.text((22 + font_size, legend_y), label, fill="#203047", font=font)
    if len(detections) > legend_count:
        draw.text((12, height + 9 + legend_count * line_height),
                  f"+{len(detections) - legend_count} more detections in the results table", fill="#526173", font=font)
    return canvas
