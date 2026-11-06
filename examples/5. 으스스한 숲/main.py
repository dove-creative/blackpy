from blackpy import Actor, stage

stage.background("forest")
cat = Actor("cat", x=-240, y=-150, name="산책하는 고양이")
bat = Actor("bat", x=40, y=100, name="빙글 박쥐")

stage.say("고양이와 박쥐의 밤 산책")
cat.forward(300)
bat.left(360)

stage.say("박쥐는 어느 쪽을 바라보나요?")
print("걷기와 제자리 돌기를 비교해 보세요.")
