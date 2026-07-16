#!/usr/bin/env python3
import os
import subprocess
import concurrent.futures

LLM_DIR = "/Volumes/LLM/app/llm-models"
SD_DIR = "/Volumes/LLM/app/models"

LLAMA_CLI = "/Volumes/LLM/app/llm-backend/mac/x64/llama-cli"
SD_CLI = "/Volumes/LLM/app/backend/mac/sd"

def is_obviously_broken(filepath):
    filename = os.path.basename(filepath)
    size_bytes = os.path.getsize(filepath)
    size_mb = size_bytes / (1024 * 1024)

    # Check for GGUF files that are too small for their parameter count
    name_lower = filename.lower()
    
    # Exclude projection files from size check
    if name_lower.startswith("mmproj") or name_lower.endswith("mmproj.gguf"):
        return False

    # Heuristics for truncated downloads
    if any(x in name_lower for x in ["9b", "12b", "8b", "7b"]) and size_mb < 1500:
        print(f"[FAST-FAIL] {filename} is too small ({size_mb:.1f} MB) for a 7B-12B model.", flush=True)
        return True
    if any(x in name_lower for x in ["2b", "3b"]) and size_mb < 500:
        print(f"[FAST-FAIL] {filename} is too small ({size_mb:.1f} MB) for a 2B-3B model.", flush=True)
        return True
    if size_mb < 10: # Except TinyLlama-5M which is ~10MB
        if "5m" not in name_lower:
            print(f"[FAST-FAIL] {filename} is too small ({size_mb:.1f} MB) to be a valid model.", flush=True)
            return True
            
    return False

def test_llm_model(filepath):
    filename = os.path.basename(filepath)
    if filename.startswith("mmproj") or filename.endswith("mmproj.gguf"):
        return filepath, True

    if is_obviously_broken(filepath):
        return filepath, False

    print(f"[TEST] Testing LLM: {filename} ...", flush=True)
    cmd = [
        LLAMA_CLI,
        "-m", filepath,
        "-p", "test",
        "-n", "1",
        "--threads", "1"
    ]
    try:
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20)
        if result.returncode == 0:
            print(f"[OK] LLM works: {filename}", flush=True)
            return filepath, True
        else:
            print(f"[FAIL] LLM failed (code {result.returncode}): {filename}", flush=True)
            return filepath, False
    except subprocess.TimeoutExpired:
        print(f"[FAIL] LLM timed out (20s): {filename}", flush=True)
        return filepath, False
    except Exception as e:
        print(f"[FAIL] LLM error {filename}: {e}", flush=True)
        return filepath, False

def test_sd_model(filepath):
    filename = os.path.basename(filepath)
    print(f"[TEST] Testing SD: {filename} ...", flush=True)
    
    out_img = f"/tmp/sd_test_{filename}.png"
    if os.path.exists(out_img):
        try: os.remove(out_img)
        except: pass

    cmd = [
        SD_CLI,
        "-m", filepath,
        "-p", "a cat",
        "-s", "1",
        "-t", "1",
        "-o", out_img
    ]
    try:
        result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=40)
        if result.returncode == 0 and os.path.exists(out_img):
            print(f"[OK] SD works: {filename}", flush=True)
            try: os.remove(out_img)
            except: pass
            return filepath, True
        else:
            print(f"[FAIL] SD failed: {filename}", flush=True)
            return filepath, False
    except subprocess.TimeoutExpired:
        print(f"[FAIL] SD timed out (40s): {filename}", flush=True)
        return filepath, False
    except Exception as e:
        print(f"[FAIL] SD error {filename}: {e}", flush=True)
        return filepath, False

def main():
    llm_files = []
    sd_files = []

    # Gather files
    if os.path.exists(LLM_DIR):
        for f in sorted(os.listdir(LLM_DIR)):
            if f.endswith(".gguf") and not f.endswith(".DELETED.gguf"):
                llm_files.append(os.path.join(LLM_DIR, f))

    if os.path.exists(SD_DIR):
        for f in sorted(os.listdir(SD_DIR)):
            if (f.endswith(".safetensors") or f.endswith(".ckpt")) and not f.endswith(".DELETED.safetensors"):
                sd_files.append(os.path.join(SD_DIR, f))

    failed_models = []

    print(f"Starting test of {len(llm_files)} LLM models and {len(sd_files)} SD models...", flush=True)

    # Run LLM tests in parallel
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        results = executor.map(test_llm_model, llm_files)
        for filepath, success in results:
            if not success:
                failed_models.append(filepath)

    # Run SD tests sequentially (they take too much VRAM/RAM to run in parallel)
    for filepath in sd_files:
        filepath, success = test_sd_model(filepath)
        if not success:
            failed_models.append(filepath)

    # Rename failed models
    if failed_models:
        print("\n--- Renaming failed models to .DELETED ---", flush=True)
        for path in failed_models:
            dir_name = os.path.dirname(path)
            base_name = os.path.basename(path)
            name, ext = os.path.splitext(base_name)
            new_name = f"{name}.DELETED{ext}"
            new_path = os.path.join(dir_name, new_name)
            
            print(f"Renaming: {base_name} -> {new_name}", flush=True)
            try:
                os.rename(path, new_path)
            except Exception as e:
                print(f"Failed to rename {base_name}: {e}", flush=True)
    else:
        print("\nAll tested models are working perfectly!", flush=True)

if __name__ == "__main__":
    main()
