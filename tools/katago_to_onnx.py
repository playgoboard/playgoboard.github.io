"""Converts a KataGo network in the text format (.txt.gz, model version 8, e.g. the
public-domain g170 networks) into an ONNX file that ONNX Runtime Web can run in the browser.

Usage (from the project folder):
    python tools/katago_to_onnx.py NETWORK.txt.gz models/dragon.onnx [--fp16]

The layer formulas follow KataGo's own code (desc.cpp and eigenbackend.cpp, MIT license,
https://github.com/lightvector/KataGo). Board size is free: the graph works for 9x9, 13x13
and 19x19. Inputs: bin_input [N,22,H,W], global_input [N,19] (KataGo input version 7).
Outputs: policy [N, H*W+1] (logits, last = pass), value [N,3] (win/loss/no-result logits),
miscvalue [N,4] (score mean, score stdev, lead, variance time; raw), ownership [N,1,H,W] (raw).
All outputs are from the point of view of the player to move.
"""
import gzip
import sys

import numpy as np
import onnx
from onnx import TensorProto, helper, numpy_helper


class Tokens:
    """KataGo's text format is a stream of whitespace-separated words and numbers."""

    def __init__(self, path):
        opener = gzip.open if path.endswith(".gz") else open
        with opener(path, "rt") as f:
            self.words = f.read().split()
        self.pos = 0

    def word(self):
        w = self.words[self.pos]
        self.pos += 1
        return w

    def int(self):
        return int(self.word())

    def floats(self, n):
        values = np.array(self.words[self.pos:self.pos + n], dtype=np.float32)
        self.pos += n
        return values


class Builder:
    def __init__(self, tokens, fp16):
        self.t = tokens
        self.fp16 = fp16
        self.nodes = []
        self.inits = []
        self.count = 0

    def name(self, base):
        self.count += 1
        return f"{base}_{self.count}"

    def const(self, array, base):
        n = self.name(base)
        array = np.asarray(array, dtype=np.float32)
        self.inits.append(numpy_helper.from_array(array, n))
        return n

    def node(self, op, inputs, base, **attrs):
        out = self.name(base)
        self.nodes.append(helper.make_node(op, inputs, [out], **attrs))
        return out

    # ---- layers, read from the file in KataGo's order ----

    def conv(self, x):
        t = self.t
        name = t.word()
        ky, kx, cin, cout, dy, dx = (t.int() for _ in range(6))
        # File order is y, x, in, out; ONNX wants out, in, y, x.
        w = t.floats(ky * kx * cin * cout).reshape(ky, kx, cin, cout).transpose(3, 2, 0, 1)
        wn = self.const(w, name.replace("/", "_") + "_w")
        pads = [dy * (ky // 2), dx * (kx // 2), dy * (ky // 2), dx * (kx // 2)]
        return self.node("Conv", [x, wn], "conv", kernel_shape=[ky, kx], dilations=[dy, dx], pads=pads), cout

    def batchnorm_act(self, x, relu=True):
        """Batch norm folded into one multiply and one add, then the activation (always ReLU in v8)."""
        t = self.t
        t.word()  # name
        c = t.int()
        eps = float(t.word())
        has_scale = t.int()
        has_bias = t.int()
        mean = t.floats(c)
        var = t.floats(c)
        scale = t.floats(c) if has_scale else np.ones(c, np.float32)
        bias = t.floats(c) if has_bias else np.zeros(c, np.float32)
        merged_scale = scale / np.sqrt(var + eps)
        merged_bias = bias - merged_scale * mean
        y = self.node("Mul", [x, self.const(merged_scale.reshape(1, c, 1, 1), "bn_s")], "bn")
        y = self.node("Add", [y, self.const(merged_bias.reshape(1, c, 1, 1), "bn_b")], "bn")
        if relu:
            t.word()  # activation layer name (ReLU for version 8)
            y = self.node("Relu", [y], "relu")
        return y

    def matmul(self, x):
        t = self.t
        t.word()
        cin, cout = t.int(), t.int()
        w = t.floats(cin * cout).reshape(cin, cout)  # file order is in, out
        return self.node("MatMul", [x, self.const(w, "mm")], "mm"), cout

    def matbias(self, x):
        t = self.t
        t.word()
        c = t.int()
        return self.node("Add", [x, self.const(t.floats(c), "mb")], "mb")

    def add_channel_bias(self, spatial, vector):
        """[N,C] added to every point of [N,C,H,W]."""
        v = self.node("Unsqueeze", [vector, self.axes], "unsq")
        return self.node("Add", [spatial, v], "addbias")

    def gpool(self, x, value_head=False):
        """KataGo's global pooling: mean, mean*(sqrt(area)-14)/10, and max (or a third mean term
        for the value head). The board has no padding here, so every point is on the board."""
        mean = self.node("ReduceMean", [x], "mean", axes=[2, 3], keepdims=0)
        a = self.node("Mul", [mean, self.width_term], "gp1")
        if value_head:
            third = self.node("Mul", [mean, self.width_term2], "gp2")
        else:
            third = self.node("ReduceMax", [x], "max", axes=[2, 3], keepdims=0)
        return self.node("Concat", [mean, a, third], "gpcat", axis=1)

    def build(self):
        t = self.t
        name = t.word()
        version = t.int()
        if version != 8:
            raise SystemExit(f"Only model version 8 is supported, this file is version {version}")
        n_spatial, n_global = t.int(), t.int()

        bin_input = helper.make_tensor_value_info("bin_input", TensorProto.FLOAT, ["N", n_spatial, "H", "W"])
        global_input = helper.make_tensor_value_info("global_input", TensorProto.FLOAT, ["N", n_global])
        self.axes = self.int64([2, 3])

        # (sqrt(board area) - 14) / 10, and the value head's second term, from the input's size.
        shape = self.node("Shape", ["bin_input"], "shape")
        hw = self.node("Slice", [shape, self.int64([2]), self.int64([4])], "hw")
        area = self.node("ReduceProd", [hw], "area", keepdims=1)
        area_f = self.node("Cast", [area], "areaf", to=TensorProto.FLOAT)
        root = self.node("Sqrt", [area_f], "sqrt")
        centered = self.node("Sub", [root, self.const(np.array([14.0]), "c14")], "c")
        self.width_term = self.node("Mul", [centered, self.const(np.array([0.1]), "c01")], "wt")
        sq = self.node("Mul", [centered, centered], "sq")
        sq = self.node("Mul", [sq, self.const(np.array([0.01]), "c001")], "sq")
        self.width_term2 = self.node("Sub", [sq, self.const(np.array([0.1]), "c01b")], "wt2")

        # ---- trunk ----
        if t.word() != "trunk":
            raise SystemExit("Unexpected file layout: no trunk")
        num_blocks = t.int()
        for _ in range(5):
            t.int()  # trunk, mid, regular, dilated, gpool channel counts (read from the layers instead)
        x, _ = self.conv("bin_input")
        g, _ = self.matmul("global_input")
        x = self.add_channel_bias(x, g)

        for _ in range(num_blocks):
            kind = t.word()
            t.word()  # block name
            if kind == "ordinary_block":
                a = self.batchnorm_act(x)
                a, _ = self.conv(a)
                a = self.batchnorm_act(a)
                a, _ = self.conv(a)
            elif kind == "gpool_block":
                a = self.batchnorm_act(x)
                regular, _ = self.conv(a)
                gp, _ = self.conv(a)
                gp = self.batchnorm_act(gp)
                bias, _ = self.matmul(self.gpool(gp))
                a = self.add_channel_bias(regular, bias)
                a = self.batchnorm_act(a)
                a, _ = self.conv(a)
            else:
                raise SystemExit(f"Unsupported block kind {kind}")
            x = self.node("Add", [x, a], "res")
        trunk = self.batchnorm_act(x)

        # ---- policy head ----
        t.word()
        p1, _ = self.conv(trunk)
        g1, _ = self.conv(trunk)
        g1 = self.batchnorm_act(g1)
        g1_pool = self.gpool(g1)
        bias, _ = self.matmul(g1_pool)
        p1 = self.add_channel_bias(p1, bias)
        p1 = self.batchnorm_act(p1)
        p2, _ = self.conv(p1)  # [N,1,H,W]
        pass_logit, _ = self.matmul(g1_pool)  # [N,1]
        flat = self.node("Flatten", [p2], "flat", axis=1)
        policy = self.node("Concat", [flat, pass_logit], "policycat", axis=1)
        self.nodes.append(helper.make_node("Identity", [policy], ["policy"]))

        # ---- value head ----
        t.word()
        v1, _ = self.conv(trunk)
        v1 = self.batchnorm_act(v1)
        v2, _ = self.matmul(self.gpool(v1, value_head=True))
        v2 = self.matbias(v2)
        t.word()  # v2 activation (ReLU)
        v2 = self.node("Relu", [v2], "relu")
        v3, _ = self.matmul(v2)
        v3 = self.matbias(v3)
        sv3, _ = self.matmul(v2)
        sv3 = self.matbias(sv3)
        own, _ = self.conv(v1)
        for src, dst in ((v3, "value"), (sv3, "miscvalue"), (own, "ownership")):
            self.nodes.append(helper.make_node("Identity", [src], [dst]))

        if t.pos != len(t.words):
            raise SystemExit(f"Read {t.pos} of {len(t.words)} words; the file layout was not what we expected")

        outputs = [
            helper.make_tensor_value_info("policy", TensorProto.FLOAT, ["N", "M"]),
            helper.make_tensor_value_info("value", TensorProto.FLOAT, ["N", 3]),
            helper.make_tensor_value_info("miscvalue", TensorProto.FLOAT, ["N", 4]),
            helper.make_tensor_value_info("ownership", TensorProto.FLOAT, ["N", 1, "H", "W"]),
        ]
        graph = helper.make_graph(self.nodes, name, [bin_input, global_input], outputs, self.inits)
        model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)],
                                  producer_name="GoBoard katago_to_onnx")
        model.ir_version = 8
        if self.fp16:
            model = to_fp16_weights(model)
        onnx.checker.check_model(model)
        return model

    def int64(self, values):
        n = self.name("i64")
        self.inits.append(numpy_helper.from_array(np.array(values, np.int64), n))
        return n


def to_fp16_weights(model):
    """Store the big weights as float16 to halve the download; they're turned back into
    float32 right away, so the math itself stays float32."""
    graph = model.graph
    new_inits, casts = [], []
    for init in graph.initializer:
        array = numpy_helper.to_array(init)
        if array.dtype == np.float32 and array.size >= 256:
            half_name = init.name + "_fp16"
            new_inits.append(numpy_helper.from_array(array.astype(np.float16), half_name))
            casts.append(helper.make_node("Cast", [half_name], [init.name], to=TensorProto.FLOAT))
        else:
            new_inits.append(init)
    del graph.initializer[:]
    graph.initializer.extend(new_inits)
    nodes = casts + list(graph.node)
    del graph.node[:]
    graph.node.extend(nodes)
    return model


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 2:
        raise SystemExit(__doc__)
    model = Builder(Tokens(args[0]), "--fp16" in sys.argv).build()
    onnx.save(model, args[1])
    print(f"Saved {args[1]}")


if __name__ == "__main__":
    main()
