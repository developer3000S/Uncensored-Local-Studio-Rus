#!/usr/bin/env python3
"""
Qwen3-TTS ONNX worker for Russian language TTS.
Reads JSON payload from stdin, writes JSON result to stdout.
"""
import json
import os
import sys
from pathlib import Path

import librosa
import numpy as np
import onnxruntime as ort
import soundfile as sf
import torch
from transformers import AutoTokenizer

MODEL_DIR = Path(os.environ.get("QWEN3_TTS_MODEL_DIR", "/root/soft/Uncensored-Local-Studio-Rus/app/tts-models/Qwen3-TTS-12Hz-1.7B-Base-ONNX"))
REFERENCE_FEMALE = MODEL_DIR / "reference_female.wav"
REFERENCE_MALE = MODEL_DIR / "reference_male.wav"
SAMPLE_RATE = 24000


def get_reference_for_voice(voice):
    female_voices = {"ru_anna", "ru_elena", "ru_olga"}
    if voice in female_voices:
        return str(REFERENCE_FEMALE)
    return str(REFERENCE_MALE)


def compute_mel(audio_path, sr=SAMPLE_RATE, n_fft=1024, hop=256, win=1024, n_mels=128, fmin=0, fmax=12000):
    from librosa.filters import mel as librosa_mel_fn
    audio, _ = librosa.load(audio_path, sr=sr, mono=True)
    y = torch.from_numpy(audio).float().unsqueeze(0)
    pad = (n_fft - hop) // 2
    y = torch.nn.functional.pad(y.unsqueeze(1), (pad, pad), mode="reflect").squeeze(1)
    hann = torch.hann_window(win)
    spec = torch.stft(y, n_fft, hop_length=hop, win_length=win, window=hann, center=False, normalized=False, onesided=True, return_complex=True)
    mag = torch.sqrt(torch.abs(spec) ** 2 + 1e-9)
    mel_basis = torch.from_numpy(librosa_mel_fn(sr=sr, n_fft=n_fft, n_mels=n_mels, fmin=fmin, fmax=fmax)).float()
    mel = torch.matmul(mel_basis, mag)
    mel = torch.log(torch.clamp(mel, min=1e-5))
    return mel.transpose(1, 2).numpy()


def silu(x):
    return x / (1.0 + np.exp(-x))


def text_project(x, fc1_w, fc1_b, fc2_w, fc2_b):
    h = x @ fc1_w.T + fc1_b
    h = silu(h)
    return h @ fc2_w.T + fc2_b


def load_embeddings(emb_dir):
    with open(emb_dir / "config.json") as f:
        cfg = json.load(f)
    d = {"config": cfg}
    d["text_emb"] = np.load(emb_dir / "text_embedding.npy")
    d["fc1_w"] = np.load(emb_dir / "text_projection_fc1_weight.npy")
    d["fc1_b"] = np.load(emb_dir / "text_projection_fc1_bias.npy")
    d["fc2_w"] = np.load(emb_dir / "text_projection_fc2_weight.npy")
    d["fc2_b"] = np.load(emb_dir / "text_projection_fc2_bias.npy")
    d["talker_codec"] = np.load(emb_dir / "talker_codec_embedding.npy")
    d["codec_head"] = np.load(emb_dir / "codec_head_weight.npy")
    d["cp_embs"] = [
        np.load(emb_dir / f"cp_codec_embedding_{i}.npy")
        for i in range(cfg["code_predictor"]["num_hidden_layers"] + 10)
        if (emb_dir / f"cp_codec_embedding_{i}.npy").exists()
    ]
    return d


def proj(embs, token_ids):
    raw = embs["text_emb"][token_ids]
    return text_project(raw.astype(np.float32), embs["fc1_w"], embs["fc1_b"], embs["fc2_w"], embs["fc2_b"])


def build_prefill(input_ids, spk_embed, embs, language):
    cfg = embs["config"]
    tc = cfg["talker"]
    H = tc["hidden_size"]
    spk_embed = np.asarray(spk_embed, dtype=np.float32).reshape(1, 1, H)
    tts_ids = np.array([[cfg["tts"]["tts_bos_token_id"], cfg["tts"]["tts_eos_token_id"], cfg["tts"]["tts_pad_token_id"]]])
    tts_projs = proj(embs, tts_ids)
    tts_bos = tts_projs[:, 0:1, :]
    tts_eos = tts_projs[:, 1:2, :]
    tts_pad = tts_projs[:, 2:3, :]
    lang_lower = language.lower()
    if lang_lower == "auto":
        codec_prefix_ids = [tc["codec_nothink_id"], tc["codec_think_bos_id"], tc["codec_think_eos_id"]]
    else:
        lang_id = tc["codec_language_id"][lang_lower]
        codec_prefix_ids = [tc["codec_think_id"], tc["codec_think_bos_id"], lang_id, tc["codec_think_eos_id"]]
    codec_prefix_emb = embs["talker_codec"][codec_prefix_ids]
    codec_pad_emb = embs["talker_codec"][tc["codec_pad_id"]]
    codec_bos_emb = embs["talker_codec"][tc["codec_bos_id"]]
    codec_ie = np.concatenate([
        codec_prefix_emb.reshape(1, -1, H),
        spk_embed,
        codec_pad_emb.reshape(1, 1, H),
        codec_bos_emb.reshape(1, 1, H),
    ], axis=1)
    C = codec_ie.shape[1]
    role_emb = proj(embs, input_ids[:, :3])
    text_side = np.concatenate([
        np.tile(tts_pad, (1, C - 2, 1)),
        tts_bos,
    ], axis=1)
    codec_side = codec_ie[:, :-1, :]
    talker_ie = np.concatenate([role_emb, text_side + codec_side], axis=1)
    text_start_idx = 3
    text_end_idx = input_ids.shape[1] - 5
    if text_end_idx <= text_start_idx:
        prefill = talker_ie
        trailing_text_ids = np.array([], dtype=np.int64)
    else:
        first_text_id = input_ids[:, text_start_idx:text_start_idx + 1]
        first_text_emb = proj(embs, first_text_id)
        last_codec = codec_ie[:, -1:, :]
        text_first_combined = first_text_emb + last_codec
        prefill = np.concatenate([talker_ie, text_first_combined], axis=1)
        trailing_text_ids = input_ids[:, text_start_idx + 1:text_end_idx].squeeze()
    return prefill.astype(np.float32), trailing_text_ids, tts_pad.astype(np.float32), tts_eos.astype(np.float32)


def sample(logits, top_k, top_p, temperature):
    if temperature == 0:
        return int(np.argmax(logits))
    logits = logits.astype(np.float64)
    if not np.isfinite(logits).any():
        return int(np.random.randint(0, len(logits)))
    logits = np.nan_to_num(logits, nan=-1e9, posinf=1e9, neginf=-1e9)
    if top_k > 0:
        kth = np.partition(logits, -top_k)[-top_k]
        logits = np.where(logits < kth, -np.inf, logits)
    finite = logits[np.isfinite(logits)]
    if len(finite) == 0:
        return int(np.argmax(logits))
    logits -= finite.max()
    probs = np.exp(logits / max(temperature, 1e-8))
    s = probs.sum()
    if s <= 0 or not np.isfinite(s):
        return int(np.argmax(logits))
    probs /= s
    if top_p < 1.0:
        sorted_idx = np.argsort(probs)[::-1]
        cumsum = np.cumsum(probs[sorted_idx])
        remove = cumsum > top_p
        remove[0] = False
        remove_shifted = np.concatenate([[False], remove[:-1]])
        probs[sorted_idx[remove_shifted]] = 0.0
        s2 = probs.sum()
        if s2 > 0:
            probs /= s2
    probs = np.nan_to_num(probs, nan=0.0)
    probs = np.clip(probs, 0.0, None)
    s3 = probs.sum()
    if s3 <= 0:
        return int(np.argmax(logits))
    probs /= s3
    return int(np.random.choice(len(probs), p=probs))


def load_sessions(onnx_dir):
    opts = ort.SessionOptions()
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    opts.inter_op_num_threads = 4
    opts.intra_op_num_threads = 4
    return {
        "prefill": ort.InferenceSession(str(onnx_dir / "talker_prefill.onnx"), opts, providers=["CPUExecutionProvider"]),
        "decode": ort.InferenceSession(str(onnx_dir / "talker_decode.onnx"), opts, providers=["CPUExecutionProvider"]),
        "cp": ort.InferenceSession(str(onnx_dir / "code_predictor.onnx"), opts, providers=["CPUExecutionProvider"]),
        "vocoder": ort.InferenceSession(str(onnx_dir / "vocoder.onnx"), opts, providers=["CPUExecutionProvider"]),
    }


def talker_prefill(sess, inputs_embeds, attn_mask, pos_ids, n_layers):
    outs = sess.run(None, {"inputs_embeds": inputs_embeds, "attention_mask": attn_mask, "position_ids": pos_ids})
    logits = outs[0]
    hidden = outs[1]
    past_keys = np.stack([outs[2 + 2 * i] for i in range(n_layers)])
    past_values = np.stack([outs[3 + 2 * i] for i in range(n_layers)])
    return logits, hidden, past_keys, past_values


def talker_decode(sess, inputs_embeds, attn_mask, pos_ids, past_keys, past_values):
    outs = sess.run(None, {
        "inputs_embeds": inputs_embeds,
        "attention_mask": attn_mask,
        "position_ids": pos_ids,
        "past_keys": past_keys,
        "past_values": past_values,
    })
    return outs[0], outs[1], outs[2], outs[3]


def cp_step(sess, inputs_embeds, generation_steps, past_keys, past_values):
    outs = sess.run(None, {
        "inputs_embeds": inputs_embeds,
        "generation_steps": generation_steps,
        "past_keys": past_keys,
        "past_values": past_values,
    })
    return outs[0], outs[1], outs[2]


def post_process(wav, target_rms=0.10, noise_floor=0.01, knee=0.80, trim_db=35.0):
    wav, _ = librosa.effects.trim(wav, top_db=trim_db)
    voiced = wav[np.abs(wav) > noise_floor]
    if len(voiced) > 0:
        rms = float(np.sqrt(np.mean(voiced ** 2)))
        if rms > 1e-8:
            wav = wav * (target_rms / rms)
    mask = np.abs(wav) > knee
    wav[mask] = np.sign(wav[mask]) * (
        knee + (1 - knee) * np.tanh((np.abs(wav[mask]) - knee) / (1 - knee))
    )
    return wav.astype(np.float32)


def synthesize(text, output_path, language="russian", max_seconds=30, temperature=0.9, top_k=50, top_p=1.0, seed=42, reference_audio=None):
    np.random.seed(seed)

    ref_path = reference_audio or str(REFERENCE_FEMALE)

    embs = load_embeddings(MODEL_DIR / "embeddings")
    cfg = embs["config"]
    tc = cfg["talker"]
    cpc = cfg["code_predictor"]
    TALKER_H = tc["hidden_size"]
    N_LAYERS = tc["num_hidden_layers"]
    CODEC_EOS = tc["codec_eos_token_id"]
    NUM_CODEBOOKS = tc["num_code_groups"]

    talker_vocab = tc["vocab_size"]
    suppress_mask = np.zeros(talker_vocab, dtype=bool)
    suppress_mask[cpc["vocab_size"]:] = True
    suppress_mask[CODEC_EOS] = False

    # Extract speaker embedding from reference audio
    mel = compute_mel(ref_path)
    spk_opts = ort.SessionOptions()
    spk_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    sess_spk = ort.InferenceSession(
        str(MODEL_DIR / "speaker_encoder.onnx"), spk_opts,
        providers=["CPUExecutionProvider"],
    )
    spk_embed = sess_spk.run(["speaker_embedding"], {"mel_spectrogram": mel.astype(np.float32)})[0]
    spk_embed = spk_embed.squeeze()
    del sess_spk

    # Tokenize text
    tokenizer = AutoTokenizer.from_pretrained(str(MODEL_DIR), local_files_only=True)
    prompt = "assistant\n" + text + "\nassistant\n"
    input_ids = tokenizer(prompt, return_tensors="pt")["input_ids"].numpy()

    # Build prefill embeddings
    prefill_embs, trailing_text_ids, tts_pad, tts_eos = build_prefill(input_ids, spk_embed, embs, language)
    T_prefill = prefill_embs.shape[1]
    T_trailing = len(trailing_text_ids)

    # Load ONNX sessions
    S = load_sessions(MODEL_DIR)

    # Prefill
    attn = np.ones((1, T_prefill), dtype=np.int64)
    pos_range = np.arange(T_prefill, dtype=np.int64).reshape(1, T_prefill)
    pos_ids = np.stack([pos_range, pos_range, pos_range])
    logits, hidden, past_keys, past_vals = talker_prefill(S["prefill"], prefill_embs, attn, pos_ids, N_LAYERS)
    del S["prefill"]
    talker_hidden = hidden[:, -1:, :]

    max_steps = int(max_seconds * 12)

    all_codes = []
    decode_pos = T_prefill
    past_len = T_prefill

    for step in range(max_steps):
        g0_logits = logits[0, 0, :].copy().astype(np.float64)
        g0_logits[suppress_mask] = -np.inf
        g0 = sample(g0_logits, top_k, top_p, temperature)

        if g0 == CODEC_EOS:
            break

        codec_tokens = np.zeros(NUM_CODEBOOKS, dtype=np.int64)
        codec_tokens[0] = g0

        cp_keys = np.zeros((cpc["num_hidden_layers"], 1, cpc["num_key_value_heads"], 0, cpc["head_dim"]), dtype=np.float32)
        cp_vals = np.zeros((cpc["num_hidden_layers"], 1, cpc["num_key_value_heads"], 0, cpc["head_dim"]), dtype=np.float32)

        g0_emb = embs["talker_codec"][g0].reshape(1, 1, TALKER_H).astype(np.float32)
        cp_in = np.concatenate([talker_hidden, g0_emb], axis=1)
        cp_logits, cp_keys, cp_vals = cp_step(S["cp"], cp_in, np.array([0], dtype=np.int64), cp_keys, cp_vals)
        g1 = sample(cp_logits[0, -1, :], top_k, top_p, temperature)
        codec_tokens[1] = g1

        for k in range(1, NUM_CODEBOOKS - 1):
            gk_emb = embs["cp_embs"][k - 1][codec_tokens[k]].reshape(1, 1, TALKER_H).astype(np.float32)
            cp_logits, cp_keys, cp_vals = cp_step(S["cp"], gk_emb, np.array([k], dtype=np.int64), cp_keys, cp_vals)
            g_next = sample(cp_logits[0, 0, :], top_k, top_p, temperature)
            codec_tokens[k + 1] = g_next

        all_codes.append(codec_tokens.copy())

        next_emb = embs["talker_codec"][g0].copy()
        for k in range(1, NUM_CODEBOOKS):
            next_emb = next_emb + embs["cp_embs"][k - 1][codec_tokens[k]]

        if step < T_trailing:
            text_emb = proj(embs, np.array([trailing_text_ids[step]])).astype(np.float32)
            next_emb = next_emb + text_emb
        else:
            next_emb = next_emb + tts_pad.flatten()

        next_emb = next_emb.reshape(1, 1, TALKER_H).astype(np.float32)

        past_len += 1
        attn_d = np.ones((1, past_len), dtype=np.int64)
        pos_d = np.full((3, 1, 1), decode_pos, dtype=np.int64)
        decode_pos += 1

        logits, talker_hidden, past_keys, past_vals = talker_decode(S["decode"], next_emb, attn_d, pos_d, past_keys, past_vals)

    if not all_codes:
        raise Exception("No frames generated.")

    codes_arr = np.stack(all_codes, axis=0)
    T_gen = codes_arr.shape[0]

    codes_voc = codes_arr.T[np.newaxis, :, :]
    wav_raw = S["vocoder"].run(["waveform"], {"codes": codes_voc.astype(np.int64)})[0]
    wav = wav_raw[0, 0]

    wav = post_process(wav)
    sf.write(output_path, wav, SAMPLE_RATE)

    return {
        "output": output_path,
        "sampleRate": SAMPLE_RATE,
        "durationMs": int(len(wav) / SAMPLE_RATE * 1000),
        "text": text,
    }


def main():
    payload = json.loads(sys.stdin.read())
    text = payload["text"]
    output_path = payload["output"]
    language = payload.get("language", "russian")
    max_seconds = payload.get("max_seconds", 30)
    voice = payload.get("voice", "ru_anna")

    result = synthesize(
        text=text,
        output_path=output_path,
        language=language,
        max_seconds=max_seconds,
        reference_audio=get_reference_for_voice(voice),
    )
    result["voice"] = voice
    result["voiceName"] = payload.get("voiceName", voice)
    result["model"] = "qwen3-tts-1.7b"
    result["modelName"] = "Qwen3-TTS 1.7B (Russian)"
    sys.stdout.write(json.dumps(result))
    sys.stdout.flush()


if __name__ == "__main__":
    main()
