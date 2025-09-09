# GPU Support Setup Guide

XaresAICoder supports optional GPU access in workspace containers for ML/AI development workloads.

## Prerequisites

### 1. NVIDIA GPU and Drivers
- NVIDIA GPU with compute capability 3.5 or higher
- NVIDIA drivers installed on host system
- Verify with: `nvidia-smi`

### 2. Docker with NVIDIA Runtime
Install nvidia-docker2 runtime:

**Ubuntu/Debian:**
```bash
# Add NVIDIA package repository
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | sudo tee /etc/apt/sources.list.d/nvidia-docker.list

# Install nvidia-docker2
sudo apt-get update
sudo apt-get install -y nvidia-docker2

# Restart Docker daemon
sudo systemctl restart docker
```

**Verify installation:**
```bash
docker run --rm --gpus all nvidia/cuda:11.8-base-ubuntu20.04 nvidia-smi
```

## Configuration

### 1. Enable GPU Support
Edit `.env` file:
```bash
# Enable GPU access
ENABLE_GPU=true

# GPU runtime (usually 'nvidia')
GPU_RUNTIME=nvidia

# Optional: GPU memory limit (e.g., "4g")
GPU_MEMORY_LIMIT=

# Use CUDA-enabled image for better ML/AI support
CODESERVER_CUDA_IMAGE=xares-aicoder-codeserver:cuda
```

### 2. Build CUDA-Enabled Image
Build the CUDA-enabled code-server image:
```bash
docker build -f code-server/Dockerfile.cuda -t xares-aicoder-codeserver:cuda ./code-server
```

This image includes:
- NVIDIA CUDA 11.8 development environment
- Python ML/AI libraries (PyTorch, TensorFlow, Transformers)
- GPU-optimized development environment

### 3. Restart Services
```bash
docker-compose down
docker-compose up -d
```

## Features

### GPU-Enabled Workspaces Include:
- **CUDA Development Environment**: Full CUDA 11.8 toolkit
- **ML/AI Libraries**: PyTorch, TensorFlow, Transformers, scikit-learn
- **Python Data Science**: NumPy, Pandas, Matplotlib, Jupyter
- **AI Coding Tools**: Aider, OpenCode SST
- **GPU Monitoring**: nvidia-smi accessible in terminals

### Workspace Environment Variables:
- `NVIDIA_VISIBLE_DEVICES=all`: Access to all GPUs
- `NVIDIA_DRIVER_CAPABILITIES=compute,utility`: GPU compute capabilities

## Usage

### 1. Create GPU-Enabled Workspace
When `ENABLE_GPU=true`, all new workspaces will have GPU access.

### 2. Verify GPU Access
In workspace terminal:
```bash
# Check GPU availability
nvidia-smi

# Test PyTorch GPU
python3 -c "import torch; print(f'CUDA available: {torch.cuda.is_available()}')"

# Test TensorFlow GPU
python3 -c "import tensorflow as tf; print(f'GPU devices: {tf.config.list_physical_devices(\"GPU\")}')"
```

### 3. Example ML Workflow
```python
import torch
import tensorflow as tf

# PyTorch GPU example
if torch.cuda.is_available():
    device = torch.device('cuda')
    tensor = torch.randn(1000, 1000).to(device)
    print(f"Tensor on GPU: {tensor.device}")

# TensorFlow GPU example
if tf.config.list_physical_devices('GPU'):
    with tf.device('/GPU:0'):
        matrix = tf.random.uniform((1000, 1000))
        print(f"Matrix on GPU: {matrix.device}")
```

## Troubleshooting

### Common Issues:

**1. Container fails to start with GPU enabled:**
- Verify nvidia-docker2 is installed: `docker run --rm --gpus all nvidia/cuda:11.8-base-ubuntu20.04 nvidia-smi`
- Check Docker daemon configuration: `/etc/docker/daemon.json`

**2. CUDA image not found:**
```bash
# Build the CUDA image
docker build -f code-server/Dockerfile.cuda -t xares-aicoder-codeserver:cuda ./code-server
```

**3. GPU not visible in workspace:**
- Verify host GPU: `nvidia-smi`
- Check container environment: `echo $NVIDIA_VISIBLE_DEVICES`
- Restart Docker service: `sudo systemctl restart docker`

**4. Out of GPU memory:**
- Set GPU memory limit in `.env`: `GPU_MEMORY_LIMIT=4g`
- Monitor GPU usage: `nvidia-smi -l 1`

### Fallback to CPU-Only:
If GPU setup fails, disable GPU support:
```bash
# In .env file
ENABLE_GPU=false
```

Workspaces will use the standard CPU-only image.

## Performance Considerations

- **Memory**: CUDA image is ~8GB (vs ~2GB standard)
- **Build time**: CUDA image takes 10-15 minutes to build
- **Resources**: GPU workspaces use more host resources
- **Concurrent workspaces**: Limit based on GPU memory

## Security Notes

- GPU access provides direct hardware access
- Consider resource limits for multi-user environments
- Monitor GPU usage to prevent resource exhaustion