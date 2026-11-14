"""Numbers to spoken words, because the speech models read letters, not digits.

"10:30 pm" -> "ten thirty p m"; "৫০০ টাকা" -> "পাঁচশো টাকা"; "15,000" -> "fifteen thousand".
"""

import re

BN_DIGITS = str.maketrans("০১২৩৪৫৬৭৮৯", "0123456789")

BN_0_99 = (
    "শূন্য এক দুই তিন চার পাঁচ ছয় সাত আট নয় দশ এগারো বারো তেরো চৌদ্দ পনেরো ষোলো সতেরো আঠারো উনিশ "
    "বিশ একুশ বাইশ তেইশ চব্বিশ পঁচিশ ছাব্বিশ সাতাশ আঠাশ ঊনত্রিশ ত্রিশ একত্রিশ বত্রিশ তেত্রিশ চৌত্রিশ পঁয়ত্রিশ ছত্রিশ সাঁইত্রিশ আটত্রিশ ঊনচল্লিশ "
    "চল্লিশ একচল্লিশ বিয়াল্লিশ তেতাল্লিশ চুয়াল্লিশ পঁয়তাল্লিশ ছেচল্লিশ সাতচল্লিশ আটচল্লিশ ঊনপঞ্চাশ পঞ্চাশ একান্ন বায়ান্ন তিপ্পান্ন চুয়ান্ন পঞ্চান্ন ছাপ্পান্ন সাতান্ন আটান্ন ঊনষাট "
    "ষাট একষট্টি বাষট্টি তেষট্টি চৌষট্টি পঁয়ষট্টি ছেষট্টি সাতষট্টি আটষট্টি ঊনসত্তর সত্তর একাত্তর বাহাত্তর তিয়াত্তর চুয়াত্তর পঁচাত্তর ছিয়াত্তর সাতাত্তর আটাত্তর ঊনআশি "
    "আশি একাশি বিরাশি তিরাশি চুরাশি পঁচাশি ছিয়াশি সাতাশি অষ্টাশি ঊননব্বই নব্বই একানব্বই বিরানব্বই তিরানব্বই চুরানব্বই পঁচানব্বই ছিয়ানব্বই সাতানব্বই আটানব্বই নিরানব্বই"
).split()

EN_ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split()
EN_TENS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split()


def bangla(n: int) -> str:
    if n < 100:
        return BN_0_99[n]
    for size, name in ((10_000_000, "কোটি"), (100_000, "লাখ"), (1000, "হাজার")):
        if n >= size:
            head, rest = divmod(n, size)
            return f"{bangla(head)} {name}" + (f" {bangla(rest)}" if rest else "")
    head, rest = divmod(n, 100)
    return f"{BN_0_99[head]}শো" + (f" {bangla(rest)}" if rest else "")


def english(n: int) -> str:
    if n < 20:
        return EN_ONES[n]
    if n < 100:
        tens, rest = divmod(n, 10)
        return EN_TENS[tens] + (f" {EN_ONES[rest]}" if rest else "")
    for size, name in ((1_000_000_000, "billion"), (1_000_000, "million"), (1000, "thousand"), (100, "hundred")):
        if n >= size:
            head, rest = divmod(n, size)
            return f"{english(head)} {name}" + (f" {english(rest)}" if rest else "")
    return str(n)


def speakable(text: str, language: str) -> str:
    say = bangla if language == "bn" else english
    out = text.translate(BN_DIGITS)
    out = out.replace("৳", " টাকা " if language == "bn" else " taka ")
    out = re.sub(r"(\d)%", r"\1 শতাংশ" if language == "bn" else r"\1 percent", out)

    def time_of_day(match):
        hours, minutes = int(match.group(1)), int(match.group(2))
        if language == "bn":
            return f"{bangla(hours)}টা {bangla(minutes)}" if minutes else f"{bangla(hours)}টা"
        return f"{english(hours)} {english(minutes) if minutes >= 10 else 'o ' + english(minutes)}" if minutes else f"{english(hours)} o'clock"

    out = re.sub(r"\b(\d{1,2}):(\d{2})\b", time_of_day, out)
    out = re.sub(r"(?<=\d),(?=\d{2,3}\b)", "", out)  # 15,000 and 1,50,000 are one number

    def number(match):
        value = match.group(0)
        if "." in value:
            whole, fraction = value.split(".", 1)
            point = " দশমিক " if language == "bn" else " point "
            return say(int(whole)) + point + " ".join(say(int(digit)) for digit in fraction)
        return say(int(value)) if len(value) <= 12 else " ".join(say(int(d)) for d in value)

    out = re.sub(r"\d+(?:\.\d+)?", number, out)
    if language != "bn":
        out = re.sub(r"\b(a|p)\.?m\.?\b", lambda m: f"{m.group(1)} m", out, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", out).strip()
